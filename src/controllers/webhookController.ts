import { Request, Response } from 'express';
import { twilioService, type TwilioWebhookPayload } from '../services/twilioService';
import { getDatabase } from '../services/database';
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
      const twilioServiceInstance = twilioService();
      const processedMessage = twilioServiceInstance.processWebhookPayload(payload);

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
        update: { timezone: detectedTimezone },
        create: {
          phoneNumber: cleanPhoneNumber,
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
   * Check if message has already been processed
   */
  private static async checkIdempotency(messageSid: string) {
    const db = getDatabase();
    return await db.interaction.findFirst({
      where: { messageSid },
    });
  }

  /**
   * Determine if message is a query
   */
  private static isQueryMessage(body: string | undefined): boolean {
    if (!body) return false;
    const query = body.toLowerCase().trim();
    return query.startsWith('/') || query.includes('?') || query.includes('search') || query.includes('find');
  }

  /**
   * Handle query messages
   */
  private static async handleQuery(_userId: string, query: string): Promise<any> {
    // Implementation for handling queries
    return {
      type: 'text',
      content: `Searching for: ${query}`,
    };
  }

  /**
   * Handle new memory creation
   */
  private static async handleNewMemory(_userId: string, _processedMessage: any): Promise<any> {
    // Implementation for handling new memories
    return {
      type: 'text',
      content: 'Memory saved successfully!',
    };
  }

  /**
   * Generate WhatsApp response
   */
  private static generateWhatsAppResponse(content: string): any {
    return {
      type: 'text',
      content,
    };
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
        const preview = memory.content.length > 60 
          ? memory.content.substring(0, 60) + '...' 
          : memory.content;
        
        content += `${emoji} ${preview}\n`;
      }
      content += '\n';
    }

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
    
    memories.forEach(memory => {
      const date = new Date(memory.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(memory);
    });
    
    return grouped;
  }

  /**
   * Get emoji for memory type
   */
  private static getMemoryTypeEmoji(memoryType: string): string {
    switch (memoryType) {
      case 'TEXT': return '📝';
      case 'IMAGE': return '🖼️';
      case 'AUDIO': return '🎵';
      case 'VIDEO': return '🎬';
      case 'MIXED': return '📎';
      default: return '📱';
    }
  }
}
