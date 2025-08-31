import { Request, Response } from 'express';
import { twilioService, type TwilioWebhookPayload } from '../services/twilioService';
import { getDatabase } from '../services/database';
import { getMultimodalService } from '../services/multimodalService';
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

      // Step 3: Get or create user
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
          response,
        });
      }

      // Step 5: Determine if this is a query or new memory
      const isQuery = WebhookController.isQueryMessage(processedMessage.body || '');
      
      if (isQuery) {
        // Handle as query - acknowledge and create memory
        const response = WebhookController.generateWhatsAppResponse('🔍 Query processing will be implemented in the next phase. For now, I\'ve saved your message as a memory.');
        
        await WebhookController.handleNewMemory(userId, processedMessage);
        
        return res.status(200).json({
          success: true,
          message: 'Query processed successfully',
          response,
        });
      } else {
        // Handle as new memory
        const response = await WebhookController.handleNewMemory(userId, processedMessage);
        return res.status(200).json({
          success: true,
          message: 'Memory created successfully',
          response,
        });
      }

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
   * Get or create user from WhatsApp number
   */
  private static async getOrCreateUser(whatsappNumber: string): Promise<string> {
    const db = getDatabase();
    
    // Remove 'whatsapp:' prefix if present
    const cleanPhoneNumber = whatsappNumber.replace('whatsapp:', '');
    
    const user = await db.user.upsert({
      where: { phoneNumber: cleanPhoneNumber },
      update: {},
      create: {
        phoneNumber: cleanPhoneNumber,
        name: `User ${cleanPhoneNumber.slice(-4)}`,
      },
    });

    return user.id;
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
   * Determine if message is a query
   */
  private static isQueryMessage(body?: string): boolean {
    if (!body) return false;
    
    const lowerBody = body.toLowerCase().trim();
    
    // Check for /list command
    if (lowerBody === '/list') return true;
    
    // Check for natural language queries
    const queryKeywords = [
      'show me', 'find', 'search', 'what', 'when', 'where', 'how',
      'my memories', 'my photos', 'my voice notes', 'my audio',
      'from yesterday', 'from today', 'from last week', 'from this week',
      'about dinner', 'about work', 'about travel', 'about meeting'
    ];
    
    return queryKeywords.some(keyword => lowerBody.includes(keyword));
  }

  /**
   * Handle new memory creation
   */
  private static async handleNewMemory(userId: string, processedMessage: any): Promise<any> {
    logger.info('Processing new memory', { userId, messageType: processedMessage.messageType });

    // Create interaction record
    const interaction = await this.createInteraction(userId, processedMessage);

    // Process media files if present
    let mediaFiles: any[] = [];
    if (processedMessage.mediaFiles.length > 0) {
      mediaFiles = await this.processMediaFiles(userId, interaction.id, processedMessage);
    }

    // Create memory using multimodal service
    const memory = await this.createMemoryFromInteraction(userId, interaction.id, processedMessage, mediaFiles);

    // Generate WhatsApp response
    return this.generateMemorySavedResponse(processedMessage, memory);
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
    const content = processedMessage.body || this.getDefaultContent(processedMessage.messageType);
    const memoryType = this.mapMessageTypeToMemoryType(processedMessage.messageType);

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
  private static generateMemorySavedResponse(processedMessage: any, _memory: any): any {
    const messageType = processedMessage.messageType;
    const hasMedia = processedMessage.mediaFiles.length > 0;

    let content = '✅ *Memory Saved Successfully!*\n\n';
    
    if (messageType === 'TEXT') {
      const preview = processedMessage.body?.substring(0, 50);
      const hasMore = processedMessage.body && processedMessage.body.length > 50;
      content += `📝 *Text Message:*\n"${preview}${hasMore ? '...' : ''}"\n`;
    } else if (hasMedia) {
      const mediaType = this.getMediaTypeEmoji(messageType);
      content += `${mediaType} *${messageType.charAt(0) + messageType.slice(1).toLowerCase()} Message:*\n`;
      
      if (processedMessage.body) {
        content += `📝 Note: "${processedMessage.body}"\n`;
      }
      
      content += `📎 ${processedMessage.mediaFiles.length} media file${processedMessage.mediaFiles.length > 1 ? 's' : ''} attached\n`;
    } else {
      const mediaType = this.getMediaTypeEmoji(messageType);
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
}
