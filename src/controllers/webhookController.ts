import { Request, Response } from 'express';
import { getDatabase } from '../services/database';
import { getTwilioService } from '../services/twilioService';
import { getMultimodalService } from '../services/multimodalService';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export const handleIncomingMessage = async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const twilioService = getTwilioService();
    const multimodalService = getMultimodalService();

    // Process the webhook payload
    const payload = twilioService.processWebhookPayload(req.body);
    
    logger.info('Processing incoming WhatsApp message', {
      messageSid: payload.MessageSid,
      from: payload.From,
      numMedia: payload.NumMedia,
      hasBody: !!payload.Body,
    });

    // Extract phone number from WhatsApp format
    const phoneNumber = payload.From.replace('whatsapp:', '');
    
    // Get or create user
    const user = await getOrCreateUser(db, phoneNumber);
    
    // Check for idempotency (prevent duplicate processing)
    const existingInteraction = await checkIdempotency(db, payload.MessageSid);
    if (existingInteraction) {
      logger.info('Message already processed, returning existing result', {
        messageSid: payload.MessageSid,
        interactionId: existingInteraction.id,
      });
      
      return res.json({
        success: true,
        message: 'Message already processed',
        userId: user.id,
        interactionId: existingInteraction.id,
        memoryId: existingInteraction.memories?.[0]?.id,
        processingStatus: 'duplicate',
      });
    }

    // Determine if this is a query or new memory
    const isQueryMessage = isQuery(payload.Body || '');
    
    if (isQueryMessage) {
      // Handle query - search memories
      const query = payload.Body || '';
      const searchResults = await multimodalService.searchMemories(query, user.id, 5);
      
      // Create interaction record
      const interaction = await db.interaction.create({
        data: {
          userId: user.id,
          messageSid: payload.MessageSid,
          messageType: 'TEXT', // Use TEXT for queries
          content: query,
          timestamp: new Date(),
          direction: 'INBOUND',
          status: 'PROCESSED',
        },
      });

      // Format response for WhatsApp
      const response = formatSearchResults(searchResults);
      
      // Send response back to user (in real implementation)
      await twilioService.sendWhatsAppMessage(payload.From, response);

      return res.json({
        success: true,
        message: 'Query processed successfully',
        userId: user.id,
        interactionId: interaction.id,
        query: query,
        resultsCount: searchResults.length,
        processingStatus: 'query',
      });

    } else {
      // Handle new memory creation
      const processedMemory = await multimodalService.processWhatsAppMessage(payload, user.id);
      
      // Create interaction record
      const interaction = await db.interaction.create({
        data: {
          userId: user.id,
          messageSid: payload.MessageSid,
          messageType: mapMemoryTypeToMessageType(processedMemory.memoryType),
          content: processedMemory.content,
          timestamp: new Date(),
          direction: 'INBOUND',
          status: 'PROCESSED',
        },
      });

      // Create memory record in database
      const memory = await db.memory.create({
        data: {
          userId: user.id,
          interactionId: interaction.id,
          mem0Id: processedMemory.id,
          content: processedMemory.content,
          memoryType: processedMemory.memoryType,
          tags: processedMemory.metadata['tags'] || [],
          importance: processedMemory.metadata['importance'] || 1,
        },
      });

      // Send confirmation message
      const confirmationMessage = `Memory saved! 📝\n\n"${processedMemory.content.substring(0, 100)}${processedMemory.content.length > 100 ? '...' : ''}"\n\nType a question to search your memories or /list to see all memories.`;
      await twilioService.sendWhatsAppMessage(payload.From, confirmationMessage);

      return res.json({
        success: true,
        message: 'Memory created successfully',
        userId: user.id,
        interactionId: interaction.id,
        memoryId: memory.id,
        mem0Id: processedMemory.id,
        memoryType: processedMemory.memoryType,
        processingStatus: 'new_memory',
      });
    }

  } catch (error) {
    logger.error('Error processing incoming message', {
      error: error instanceof Error ? error.message : 'Unknown error',
      body: req.body,
    });

    if (error instanceof BadRequestError) {
      return res.status(400).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: ErrorCodes.INTERNAL_ERROR,
    });
  }
};

// Helper functions
async function getOrCreateUser(db: any, phoneNumber: string) {
  try {
    // Try to find existing user
    let user = await db.user.findUnique({
      where: { phoneNumber },
    });

    if (!user) {
      // Create new user
      user = await db.user.create({
        data: {
          phoneNumber,
          timezone: 'UTC', // Default timezone, can be updated later
        },
      });

      logger.info('Created new user', {
        userId: user.id,
        phoneNumber,
      });
    }

    return user;
  } catch (error) {
    logger.error('Error getting or creating user', {
      error: error instanceof Error ? error.message : 'Unknown error',
      phoneNumber,
    });
    throw new BadRequestError(
      `Failed to get or create user: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ErrorCodes.INVALID_INPUT
    );
  }
}

async function checkIdempotency(db: any, messageSid: string) {
  try {
    const existingInteraction = await db.interaction.findUnique({
      where: { messageSid },
      include: {
        memories: true,
      },
    });

    return existingInteraction;
  } catch (error) {
    logger.error('Error checking idempotency', {
      error: error instanceof Error ? error.message : 'Unknown error',
      messageSid,
    });
    // Don't throw error for idempotency check, just return null
    return null;
  }
}

function isQuery(content: string): boolean {
  const queryKeywords = [
    'what', 'when', 'where', 'who', 'how', 'why',
    'show', 'find', 'search', 'list', 'get', 'tell',
    'remember', 'recall', 'remind', 'when did', 'where did',
    'what did', 'how did', 'why did'
  ];

  const lowerContent = content.toLowerCase();
  
  // Check for question marks
  if (lowerContent.includes('?')) {
    return true;
  }

  // Check for query keywords
  for (const keyword of queryKeywords) {
    if (lowerContent.includes(keyword)) {
      return true;
    }
  }

  // Check for /list command
  if (lowerContent.trim() === '/list') {
    return true;
  }

  return false;
}

function mapMemoryTypeToMessageType(memoryType: string): 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' {
  switch (memoryType) {
    case 'IMAGE': return 'IMAGE';
    case 'AUDIO': return 'AUDIO';
    case 'VIDEO': return 'VIDEO';
    case 'MIXED': return 'DOCUMENT'; // Map MIXED to DOCUMENT for message type
    default: return 'TEXT';
  }
}

function formatSearchResults(memories: any[]): string {
  if (memories.length === 0) {
    return "I couldn't find any memories matching your query. Try different keywords or check your saved memories with /list";
  }

  let response = `Found ${memories.length} memory${memories.length > 1 ? 'ies' : 'y'}:\n\n`;
  
  memories.forEach((memory, index) => {
    const content = memory.content.length > 100 
      ? memory.content.substring(0, 100) + '...' 
      : memory.content;
    
    response += `${index + 1}. ${content}\n`;
    
    if (memory.metadata?.timestamp) {
      const date = new Date(memory.metadata.timestamp).toLocaleDateString();
      response += `   📅 ${date}\n`;
    }
    
    if (memory.metadata?.tags && memory.metadata.tags.length > 0) {
      response += `   🏷️  ${memory.metadata.tags.join(', ')}\n`;
    }
    
    response += '\n';
  });

  response += 'Use /list to see all your memories.';
  
  return response;
}
