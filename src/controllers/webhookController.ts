import { Request, Response } from 'express';
import { twilioService, type TwilioWebhookPayload } from '../services/twilioService';
import { getDatabase } from '../services/database';
import { getTimezoneService } from '../services/timezoneService';
import { IntentClassificationService } from '../services/intentClassificationService';
import { getMultimodalService } from '../services/multimodalService';
import { getReminderService } from '../services/reminderService';

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

      // Step 5: Use intent classification to determine how to handle the message
      const intentService = new IntentClassificationService();
      const intentClassification = await intentService.classifyIntent(processedMessage.body || '');
      
      logger.info('Intent classification result', {
        messageSid: processedMessage.messageSid,
        intent: intentClassification.intent,
        confidence: intentClassification.confidence,
      });

      // Handle different intents
      if (intentClassification.intent === 'LIST_COMMAND') {
        const listResponse = await WebhookController.handleListCommand(userId);
        
        // Send response back to WhatsApp
        await WebhookController.sendWhatsAppResponse(processedMessage.from, listResponse.content);
        
        return res.status(200).json({
          success: true,
          message: 'List command processed successfully',
          messageSid: processedMessage.messageSid,
          userId,
          processingStatus: 'list_processed',
          response: listResponse,
        });
      } else if (intentClassification.intent === 'MEMORY_QUERY') {
        const queryResponse = await WebhookController.handleQuery(userId, processedMessage.body || '');
        
        // Send response back to WhatsApp
        await WebhookController.sendWhatsAppResponse(processedMessage.from, queryResponse.content);
        
        return res.status(200).json({
          success: true,
          message: 'Query processed successfully',
          messageSid: processedMessage.messageSid,
          userId,
          processingStatus: 'query_processed',
          response: queryResponse,
        });
      } else if (intentClassification.intent === 'REMINDER_CREATION') {
        const reminderResponse = await WebhookController.handleReminderCreation(userId, processedMessage.body || '', intentClassification);
        
        // Send response back to WhatsApp
        await WebhookController.sendWhatsAppResponse(processedMessage.from, reminderResponse.content);
        
        return res.status(200).json({
          success: true,
          message: 'Reminder created successfully',
          messageSid: processedMessage.messageSid,
          userId,
          processingStatus: 'reminder_created',
          response: reminderResponse,
        });
      }

      // Step 6: Handle as new memory
      const memoryResponse = await WebhookController.handleNewMemory(userId, processedMessage);
      
      // Send response back to WhatsApp
      await WebhookController.sendWhatsAppResponse(processedMessage.from, memoryResponse.content);
      
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
   * Handle list command to show all memories
   */
  private static async handleListCommand(userId: string): Promise<any> {
    try {
      const db = getDatabase();
      
      // Get recent memories for the user
      const memories = await db.memory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10, // Limit to last 10 memories for WhatsApp
        select: {
          id: true,
          content: true,
          memoryType: true,
          createdAt: true,
          tags: true,
        },
      });

      if (memories.length === 0) {
        return {
          type: 'text',
          content: '📝 You don\'t have any memories saved yet. Send me a message to create your first memory!',
        };
      }

      // Format memories for WhatsApp display
      let listMessage = `📚 *Your Recent Memories* (${memories.length} shown)\n\n`;
      
      memories.forEach((memory, index) => {
        const date = new Date(memory.createdAt).toLocaleDateString();
        const type = memory.memoryType === 'TEXT' ? '💬' : memory.memoryType === 'IMAGE' ? '🖼️' : '🎵';
        const content = memory.content.length > 60 
          ? memory.content.substring(0, 60) + '...' 
          : memory.content;
        
        listMessage += `${index + 1}. ${type} *${date}*\n${content}\n\n`;
      });
      
      listMessage += `💡 Type your question to search memories, or send new content to create more!`;

      return {
        type: 'text',
        content: listMessage,
      };

    } catch (error) {
      logger.error('Error handling list command', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
      });
      
      return {
        type: 'text',
        content: '❌ Sorry, I couldn\'t retrieve your memories right now. Please try again later.',
      };
    }
  }

  /**
   * Handle query messages
   */
  private static async handleQuery(userId: string, query: string): Promise<any> {
    try {
      const multimodalService = getMultimodalService();
      
      // Search memories using the multimodal service
      const searchResults = await multimodalService.searchMemories(query, userId, 5);
      
      if (searchResults.length === 0) {
        return {
          type: 'text',
          content: `🔍 No memories found for: "${query}"\n\nTry rephrasing your search or use /list to see all memories.`,
        };
      }
      
      // Format search results for WhatsApp
      let responseMessage = `🔍 *Found ${searchResults.length} memory(ies) for: "${query}"*\n\n`;
      
      searchResults.forEach((memory, index) => {
        const date = new Date(memory.metadata['createdAt'] || Date.now()).toLocaleDateString();
        const type = memory.memoryType === 'TEXT' ? '💬' : memory.memoryType === 'IMAGE' ? '🖼️' : '🎵';
        const content = memory.content.length > 80 
          ? memory.content.substring(0, 80) + '...' 
          : memory.content;
        
        responseMessage += `${index + 1}. ${type} *${date}*\n${content}\n\n`;
      });
      
      responseMessage += `💡 Type /list to see all memories or ask another question!`;
      
      return {
        type: 'text',
        content: responseMessage,
      };
      
    } catch (error) {
      logger.error('Error handling query', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        query,
      });
      
      return {
        type: 'text',
        content: `❌ Sorry, I couldn't search your memories right now. Please try again later.`,
      };
    }
  }

  /**
   * Handle reminder creation from WhatsApp message
   */
  private static async handleReminderCreation(userId: string, message: string, intentClassification: any): Promise<any> {
    try {
      const reminderService = getReminderService();
      const multimodalService = getMultimodalService();
      
      // First, create a memory for the reminder content
      const memoryResponse = await multimodalService.processWhatsAppMessage(
        {
          MessageSid: `reminder_${Date.now()}`,
          From: 'whatsapp:reminder',
          To: 'whatsapp:system',
          Body: message,
          NumMedia: '0',
          Timestamp: new Date().toISOString(),
          AccountSid: 'reminder_account'
        } as any,
        userId
      );
      
      // Extract time and message from intent classification
      const reminderTime = intentClassification.extractedInfo?.reminderTime || 'tomorrow';
      const reminderMessage = intentClassification.extractedInfo?.reminderMessage || message;
      
      // Create the reminder using natural language parsing
      const reminder = await reminderService.parseAndCreateReminder(
        userId,
        memoryResponse.id,
        reminderTime,
        reminderMessage
      );
      
      if (!reminder) {
        return {
          type: 'text',
          content: `⚠️ I couldn't understand the time "${reminderTime}". Please try something like:\n\n• "Remind me tomorrow at 3 PM"\n• "Remind me in 2 hours"\n• "Set a reminder for next week"\n\nI've saved your message as a memory instead.`
        };
      }
      
      // Format success response
      const scheduledTime = new Date(reminder.scheduledFor);
      const timeString = scheduledTime.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      
      logger.info('Reminder created via WhatsApp', {
        reminderId: reminder.id,
        userId,
        scheduledFor: reminder.scheduledFor,
        message: reminderMessage,
        originalIntent: message
      });
      
      return {
        type: 'text',
        content: `⏰ *Reminder Set!*\n\n📝 *Message:* ${reminderMessage}\n🕐 *When:* ${timeString}\n\n✅ I'll remind you via WhatsApp at the scheduled time.\n\n💡 You can also view your reminders anytime by asking "show my reminders"`
      };
      
    } catch (error) {
      logger.error('Error creating reminder from WhatsApp', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        message,
        intentClassification
      });
      
      return {
        type: 'text',
        content: '❌ Sorry, I couldn\'t create the reminder right now. I\'ve saved your message as a memory instead. Please try again later.'
      };
    }
  }

  /**
   * Handle new memory creation
   */
  private static async handleNewMemory(userId: string, processedMessage: any): Promise<any> {
    try {
      const multimodalService = getMultimodalService();
      
      // Create WhatsApp payload for multimodal processing
      const whatsappPayload = {
        MessageSid: processedMessage.messageSid,
        From: processedMessage.from,
        To: processedMessage.to,
        Body: processedMessage.body,
        NumMedia: '0', // Simplified for text messages
      };
      
      // Process the message as a new memory
      const processedMemory = await multimodalService.processWhatsAppMessage(
        whatsappPayload as any,
        userId
      );
      
      logger.info('Memory created successfully', {
        memoryId: processedMemory.id,
        memoryType: processedMemory.memoryType,
        userId,
      });
      
      return {
        type: 'text',
        content: '✅ Memory saved successfully! I\'ve stored this for you.',
      };
      
    } catch (error) {
      logger.error('Error creating new memory', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        messageSid: processedMessage.messageSid,
      });
      
      return {
        type: 'text',
        content: '❌ Sorry, I couldn\'t save your memory right now. Please try again later.',
      };
    }
  }

  /**
   * Send response back to WhatsApp
   */
  private static async sendWhatsAppResponse(to: string, content: string): Promise<void> {
    try {
      const twilioServiceInstance = twilioService();
      
      // Extract phone number from WhatsApp format (remove 'whatsapp:' prefix)
      const phoneNumber = to.replace('whatsapp:', '');
      
      await twilioServiceInstance.sendWhatsAppMessage(phoneNumber, content);
      
      logger.info('WhatsApp response sent successfully', {
        to: phoneNumber,
        contentLength: content.length,
      });
    } catch (error) {
      logger.error('Failed to send WhatsApp response', {
        to,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw error to prevent webhook failure
    }
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
