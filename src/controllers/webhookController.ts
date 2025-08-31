import { Request, Response } from 'express';
import { twilioService, type TwilioWebhookPayload } from '../services/twilioService';
import { getDatabase } from '../services/database';
import { getMultimodalService } from '../services/multimodalService';
import { getTimezoneService } from '../services/timezoneService';
import logger from '../config/logger';

export class WebhookController {
  /**
   * Handle incoming Twilio WhatsApp messages
   * POST /webhook
   */
  static async handleIncomingMessage(req: Request, res: Response) {
    try {
      logger.info('Received WhatsApp webhook', {
        method: req.method,
        url: req.url,
        messageSid: req.body.MessageSid,
        from: req.body.From,
      });

      // Step 1: Validate webhook signature (disabled for testing)
      logger.debug('Development mode - skipping signature verification');

      // Step 2: Process and validate webhook payload
      const payload = req.body as TwilioWebhookPayload;
      const processedMessage = twilioService().processWebhookPayload(payload);

      logger.info('Processing webhook payload', {
        messageSid: processedMessage.messageSid,
        from: processedMessage.from,
        messageType: processedMessage.messageType,
        hasBody: !!processedMessage.body,
        mediaCount: processedMessage.mediaFiles.length,
      });

      // Step 3: Get or create user with timezone detection
      const userId = await WebhookController.getOrCreateUser(processedMessage.from);

      // Step 4: Check for idempotency
      const existingInteraction = await WebhookController.checkIdempotency(processedMessage.messageSid);
      if (existingInteraction) {
        logger.info('Message already processed, returning existing response', {
          messageSid: processedMessage.messageSid,
          interactionId: existingInteraction.id,
        });
        
        const response = WebhookController.generateWhatsAppResponse('✅ Memory already saved! I\'ve stored this for you.');
        return res.status(200).json({
          success: true,
          message: 'Webhook already processed',
          messageSid: processedMessage.messageSid,
          userId,
          interactionId: existingInteraction.id,
          processingStatus: 'already_processed',
          response,
        });
      }

      // Step 5: Determine if this is a query or new memory
      if (WebhookController.isQueryMessage(processedMessage.body)) {
        const queryResponse = await WebhookController.handleQuery(userId, processedMessage.body || '');
        return res.status(200).json({
          success: true,
          message: 'Query processed successfully',
          messageSid: processedMessage.messageSid,
          userId,
          processingStatus: 'query_processed',
          response: queryResponse,
        });
      }

      // Step 6: Handle as new memory
      const memoryResponse = await WebhookController.handleNewMemory(userId, processedMessage);
      return res.status(200).json({
        success: true,
        message: 'Webhook processed successfully',
        messageSid: processedMessage.messageSid,
        userId,
        processingStatus: 'completed',
        response: memoryResponse,
      });

    } catch (error) {
      logger.error('Error processing webhook', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      const errorResponse = WebhookController.generateWhatsAppResponse(
        'Sorry, I encountered an error while processing your message. Please try again.'
      );

      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        response: errorResponse,
      });
    }
  }

  /**
   * Get or create user from WhatsApp number with timezone detection
   */
  private static async getOrCreateUser(whatsappNumber: string): Promise<string> {
    const db = getDatabase();
    const timezoneService = getTimezoneService();
    
    // Remove 'whatsapp:' prefix if present
    const cleanPhoneNumber = whatsappNumber.replace('whatsapp:', '').trim();
    
    // Detect timezone from phone number using timezone service
    const detectedTimezone = timezoneService.detectTimezoneFromPhoneNumber(cleanPhoneNumber);
    
    try {
      logger.info('Attempting to create/find user', { cleanPhoneNumber, detectedTimezone });
      
      const user = await db.user.upsert({
        where: { phoneNumber: cleanPhoneNumber },
        update: {
          timezone: detectedTimezone, // Update timezone if user exists
        },
        create: {
          phoneNumber: cleanPhoneNumber,
          name: `User ${cleanPhoneNumber.slice(-4)}`,
          timezone: detectedTimezone,
        },
      });

      logger.info('User created/found successfully', { userId: user.id, phoneNumber: user.phoneNumber, timezone: user.timezone });
      return user.id;
    } catch (error) {
      logger.error('Error creating user', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        cleanPhoneNumber 
      });
      throw error;
    }
  }

  /**
   * Check for idempotency using Twilio MessageSid
   */
  private static async checkIdempotency(messageSid: string): Promise<any> {
    const db = getDatabase();
    return await db.interaction.findFirst({
      where: { messageSid: messageSid },
      include: { memories: true },
    });
  }

  /**
   * Determine if message is a query with enhanced detection
   */
  private static isQueryMessage(body?: string): boolean {
    if (!body) return false;
    
    const lowerBody = body.toLowerCase().trim();
    
    // Check for /list command
    if (lowerBody === '/list') return true;
    
    // Check for natural language queries including time-based queries
    const queryKeywords = [
      'show me', 'find', 'search', 'what', 'when', 'where', 'how',
      'my memories', 'my photos', 'my voice notes', 'my audio',
      'from yesterday', 'from today', 'from last week', 'from this week',
      'about dinner', 'about work', 'about travel', 'about meeting',
      'last week', 'yesterday', 'today', 'this week', 'this month',
      'last month', 'last year', 'this year', 'recent', 'old',
      'mood', 'happy', 'sad', 'excited', 'worried', 'location', 'where'
    ];
    
    return queryKeywords.some(keyword => lowerBody.includes(keyword));
  }

  /**
   * Handle query with timezone-aware processing
   */
  private static async handleQuery(userId: string, query: string): Promise<any> {
    logger.info('Processing query', { userId, query });

    // Check if it's a /list command
    if (query.toLowerCase().trim() === '/list') {
      return await WebhookController.handleListCommand(userId);
    }

    // Handle natural language query with timezone awareness
    return await WebhookController.handleNaturalLanguageQuery(userId, query);
  }

  /**
   * Handle /list command using database directly
   */
  private static async handleListCommand(userId: string): Promise<any> {
    const db = getDatabase();
    
    // Get memories directly from database
    const memories = await db.memory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: {
        user: {
          select: {
            id: true,
            phoneNumber: true,
            name: true,
          },
        },
        interaction: {
          select: {
            id: true,
            messageType: true,
            content: true,
          },
        },
      },
    });
    
    // Format for WhatsApp
    return await WebhookController.formatListResponseForWhatsApp(memories);
  }

  /**
   * Handle natural language query with timezone awareness
   */
  private static async handleNaturalLanguageQuery(userId: string, query: string): Promise<any> {
    const timezoneService = getTimezoneService();
    const db = getDatabase();
    
    // Parse time-based queries
    const timeFilter = await timezoneService.parseTimeQuery(query, userId);
    
    // Build search conditions
    const whereConditions: any = { userId };
    
    // Add time-based filtering if present
    if (timeFilter.startDate) {
      whereConditions.createdAt = {
        gte: timeFilter.startDate,
        ...(timeFilter.endDate && { lte: timeFilter.endDate })
      };
    }
    
    // Search memories from database
    const memories = await db.memory.findMany({
      where: whereConditions,
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        user: {
          select: {
            id: true,
            phoneNumber: true,
            name: true,
          },
        },
        interaction: {
          select: {
            id: true,
            messageType: true,
            content: true,
          },
        },
      },
    });
    
    // Format for WhatsApp
    return await WebhookController.formatSearchResponseForWhatsApp(memories, query);
  }

  /**
   * Handle new memory creation
   */
  private static async handleNewMemory(userId: string, processedMessage: any): Promise<any> {
    logger.info('Processing new memory', { userId, messageType: processedMessage.messageType });

    // Create interaction record
    const interaction = await WebhookController.createInteraction(userId, processedMessage);

    // Process media files if present
    let mediaFiles: any[] = [];
    if (processedMessage.mediaFiles.length > 0) {
      mediaFiles = await WebhookController.processMediaFiles(userId, interaction.id, processedMessage);
    }

    // Create memory using multimodal service
    await WebhookController.createMemoryFromInteraction(userId, interaction.id, processedMessage, mediaFiles);

    // Generate WhatsApp response
    return WebhookController.generateMemorySavedResponse(processedMessage);
  }

  /**
   * Create interaction record
   */
  private static async createInteraction(userId: string, processedMessage: any): Promise<any> {
    const db = getDatabase();
    
    return await db.interaction.create({
      data: {
        userId,
        messageSid: processedMessage.messageSid,
        messageType: processedMessage.messageType,
        content: processedMessage.body || '',
        metadata: {
          twilioMessageSid: processedMessage.messageSid,
          from: processedMessage.from,
          to: processedMessage.to,
          numMedia: processedMessage.mediaFiles.length,
        },
        timestamp: processedMessage.timestamp,
        direction: 'INBOUND',
        status: 'PENDING',
      },
    });
  }

  /**
   * Process media files with deduplication
   */
  private static async processMediaFiles(userId: string, interactionId: string, processedMessage: any): Promise<any[]> {
    const mediaFiles: any[] = [];

    for (const mediaFile of processedMessage.mediaFiles) {
      try {
        // Use multimodal service to process media
        const multimodalService = getMultimodalService();
        const processedMedia = await multimodalService.processTwilioMedia(
          userId,
          interactionId,
          [mediaFile.url],
          [mediaFile.contentType]
        );
        
        mediaFiles.push(...processedMedia);
      } catch (error) {
        logger.error('Error processing media file', {
          mediaUrl: mediaFile.url,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return mediaFiles;
  }

  /**
   * Create memory from interaction
   */
  private static async createMemoryFromInteraction(userId: string, interactionId: string, processedMessage: any, mediaFiles: any[]): Promise<any> {
    const multimodalService = getMultimodalService();
    
    // Determine content based on message type
    const content = processedMessage.body || WebhookController.getDefaultContent(processedMessage.messageType);
    const memoryType = WebhookController.mapMessageTypeToMemoryType(processedMessage.messageType);

    // Create memory using multimodal service
    const mem0Id = await multimodalService.processMultimodalContent({
      userId,
      interactionId,
      content,
      memoryType,
      mediaFiles,
      tags: [],
      importance: 1,
    });

    // Create memory in database
    const db = getDatabase();
    const memory = await db.memory.create({
      data: {
        userId,
        interactionId,
        content,
        memoryType,
        tags: [],
        importance: 1,
        mem0Id,
      },
    });

    // Update interaction status
    await db.interaction.update({
      where: { id: interactionId },
      data: { status: 'PROCESSED' },
    });

    return memory;
  }

  /**
   * Get default content for media messages
   */
  private static getDefaultContent(messageType: string): string {
    switch (messageType) {
      case 'IMAGE': return 'Image message';
      case 'AUDIO': return 'Audio message';
      case 'VIDEO': return 'Video message';
      case 'DOCUMENT': return 'Document message';
      default: return 'Message';
    }
  }

  /**
   * Map message type to memory type
   */
  private static mapMessageTypeToMemoryType(messageType: string): 'TEXT' | 'IMAGE' | 'AUDIO' | 'MIXED' {
    switch (messageType) {
      case 'IMAGE': return 'IMAGE';
      case 'AUDIO': return 'AUDIO';
      case 'VIDEO': return 'MIXED';
      case 'DOCUMENT': return 'TEXT';
      default: return 'TEXT';
    }
  }

  /**
   * Generate memory saved response
   */
  private static generateMemorySavedResponse(processedMessage: any): any {
    const messageType = processedMessage.messageType;
    const hasMedia = processedMessage.mediaFiles.length > 0;

    let content = '✅ *Memory Saved Successfully!*\n\n';
    
    if (messageType === 'TEXT') {
      const preview = processedMessage.body?.substring(0, 50);
      const hasMore = processedMessage.body && processedMessage.body.length > 50;
      content += `📝 *Text Message:*\n"${preview}${hasMore ? '...' : ''}"\n`;
    } else if (hasMedia) {
      const mediaType = WebhookController.getMediaTypeEmoji(messageType);
      content += `${mediaType} *${messageType.charAt(0) + messageType.slice(1).toLowerCase()} Message:*\n`;
      
      if (processedMessage.body) {
        content += `📝 Note: "${processedMessage.body}"\n`;
      }
      
      content += `📎 ${processedMessage.mediaFiles.length} media file${processedMessage.mediaFiles.length > 1 ? 's' : ''} attached\n`;
    } else {
      const mediaType = WebhookController.getMediaTypeEmoji(messageType);
      content += `${mediaType} *${messageType.charAt(0) + messageType.slice(1).toLowerCase()} Message:*\n`;
    }

    content += '\n💡 *What you can do next:*\n';
    content += '• Ask me about your memories\n';
    content += '• Use */list* to see all memories\n';
    content += '• Search with natural language\n';
    content += '• Send photos, voice notes, or text';

    return {
      type: 'text',
      content,
    };
  }

  /**
   * Generate WhatsApp response
   */
  private static generateWhatsAppResponse(message: string): any {
    return {
      type: 'text',
      content: message,
    };
  }

  /**
   * Get emoji for media type
   */
  private static getMediaTypeEmoji(messageType: string): string {
    switch (messageType) {
      case 'IMAGE': return '🖼️';
      case 'AUDIO': return '🎵';
      case 'VIDEO': return '🎬';
      case 'DOCUMENT': return '📄';
      default: return '📱';
    }
  }

  /**
   * Format list response for WhatsApp
   */
  private static async formatListResponseForWhatsApp(memories: any[]): Promise<any> {
    if (!memories || memories.length === 0) {
      return WebhookController.generateWhatsAppResponse(
        '📝 *No memories found*\n\nStart by sending me a message, photo, or voice note!'
      );
    }

    let content = `📚 *Your Memories (${memories.length})*\n\n`;
    
    // Group memories by date
    const groupedMemories = WebhookController.groupMemoriesByDate(memories);
    
    for (const [date, dayMemories] of Object.entries(groupedMemories)) {
      content += `📅 *${date}*\n`;
      
      for (const memory of dayMemories) {
        const emoji = WebhookController.getMemoryTypeEmoji(memory.memoryType);
        const preview = memory.content.length > 50 
          ? memory.content.substring(0, 50) + '...' 
          : memory.content;
        
        content += `${emoji} ${preview}\n`;
      }
      content += '\n';
    }

    content += '💡 *Try asking:*\n';
    content += '• "Show me memories from yesterday"\n';
    content += '• "Find my photos from last week"\n';
    content += '• "What did I say about dinner?"';

    return {
      type: 'text',
      content,
    };
  }

  /**
   * Format search response for WhatsApp
   */
  private static async formatSearchResponseForWhatsApp(memories: any[], query: string): Promise<any> {
    if (!memories || memories.length === 0) {
      return WebhookController.generateWhatsAppResponse(
        `🔍 *No memories found for "${query}"*\n\nTry:\n• Different keywords\n• Time-based queries like "yesterday"\n• Use /list to see all memories`
      );
    }

    let content = `🔍 *Found ${memories.length} memory${memories.length > 1 ? 'ies' : ''} for "${query}"*\n\n`;
    
    for (let i = 0; i < Math.min(memories.length, 5); i++) {
      const memory = memories[i];
      const emoji = WebhookController.getMemoryTypeEmoji(memory.memoryType);
      const date = new Date(memory.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const preview = memory.content.length > 60 
        ? memory.content.substring(0, 60) + '...' 
        : memory.content;
      
      content += `${i + 1}. ${emoji} *${date}*\n`;
      content += `   ${preview}\n\n`;
    }

    if (memories.length > 5) {
      content += `... and ${memories.length - 5} more memories\n\n`;
    }

    content += '💡 *Try:*\n';
    content += '• "Show me more"\n';
    content += '• "From yesterday"\n';
    content += '• Use /list for all memories';

    return {
      type: 'text',
      content,
    };
  }

  /**
   * Group memories by date
   */
  private static groupMemoriesByDate(memories: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    
    for (const memory of memories) {
      const date = new Date(memory.createdAt).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(memory);
    }
    
    return grouped;
  }

  /**
   * Get emoji for memory type
   */
  private static getMemoryTypeEmoji(memoryType: string): string {
    switch (memoryType) {
      case 'IMAGE': return '🖼️';
      case 'AUDIO': return '🎵';
      case 'VIDEO': return '🎬';
      case 'MIXED': return '📎';
      default: return '📝';
    }
  }
}
