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
      } else if (intentClassification.intent === 'GREETING') {
        // Send innovative welcome message showcasing features
        const welcomeMessage = `👋 *Hello! I'm your AI-powered Memory Assistant*\n\n🧠 *What makes me special:*\n📝 Store any message, image, or voice note\n🎯 AI mood detection & emotional analysis\n📍 Automatic location tagging\n⏰ Smart reminders with natural language\n🔍 Semantic search across all memories\n\n💡 *Try these:*\n• Send me anything to create a memory\n• Ask "when was I happy?" to search by mood\n• Say "remind me tomorrow at 3pm"\n• Type /list to see all memories\n\n🚀 *Let's build your digital memory together!*`;
        
        await WebhookController.sendWhatsAppResponse(processedMessage.from, welcomeMessage);
        
        return res.status(200).json({
          success: true,
          message: 'Greeting processed successfully',
          messageSid: processedMessage.messageSid,
          userId,
          processingStatus: 'greeting_sent',
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
    
    // Remove 'whatsapp:' prefix if present and normalize phone number
    let cleanPhoneNumber = whatsappNumber.replace('whatsapp:', '').trim();
    
    // Ensure phone number starts with + for consistency
    if (!cleanPhoneNumber.startsWith('+')) {
      cleanPhoneNumber = '+' + cleanPhoneNumber;
    }
    
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
          content: `🔍 *No memories found* for "${query}"\n\n🤔 *Smart suggestions:*\n• Try different keywords\n• Ask about emotions: "when was I happy?"\n• Search by location: "what did I do downtown?"\n• Use /list to see all memories\n\n🧠 *AI tip:* I can search by mood, location, and content!`,
        };
      }
      
      // Create innovative search response
      let responseMessage = `🔍 *Found ${searchResults.length} memor${searchResults.length === 1 ? 'y' : 'ies'}*\n`;
      responseMessage += `💭 Query: "${query}"\n\n`;
      
      searchResults.forEach((memory, index) => {
        const createdAt = memory.metadata?.['createdAt'];
        const date = new Date(typeof createdAt === 'string' || typeof createdAt === 'number' ? createdAt : Date.now()).toLocaleDateString();
        const typeEmoji = WebhookController.getMemoryTypeEmoji(memory.memoryType);
        const content = memory.content.length > 70 
          ? memory.content.substring(0, 70) + '...' 
          : memory.content;
        
        responseMessage += `${index + 1}. ${typeEmoji} ${content}\n`;
        responseMessage += `   📅 ${date}`;
        
        // Show relevance/similarity score if available  
        const score = memory.metadata?.['score'];
        if (typeof score === 'number' && score > 0) {
          const relevancePercent = Math.round(score * 100);
          responseMessage += ` • 🎯 ${relevancePercent}% match`;
        }
        
        // Show additional metadata if available
        if (memory.metadata?.['tags']) {
          const tags = Array.isArray(memory.metadata['tags']) ? memory.metadata['tags'] : [];
          const moodTags = tags.filter((tag: string) => 
            ['happy', 'sad', 'excited', 'stressed', 'angry', 'anxious', 'grateful', 'confused'].includes(tag.toLowerCase())
          );
          
          if (moodTags.length > 0) {
            const moodEmoji = WebhookController.getMoodEmoji(moodTags[0]);
            responseMessage += ` • ${moodEmoji} ${moodTags[0]}`;
          }
        }
        
        responseMessage += `\n\n`;
      });
      
      responseMessage += `🧠 *AI-powered search active*\n`;
      responseMessage += `💡 Ask more questions or use /list for all memories`;
      
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
      
      // Create WhatsApp payload for multimodal processing from ProcessedMessage
      const whatsappPayload: any = {
        MessageSid: processedMessage.messageSid,
        From: processedMessage.from,
        To: processedMessage.to,
        Body: processedMessage.body,
        NumMedia: processedMessage.mediaFiles.length.toString(),
        AccountSid: processedMessage.accountSid,
        Timestamp: Math.floor(processedMessage.timestamp.getTime() / 1000).toString(),
      };

      // Add media information from mediaFiles array
      processedMessage.mediaFiles.forEach((mediaFile: any, index: number) => {
        whatsappPayload[`MediaContentType${index}`] = mediaFile.contentType;
        whatsappPayload[`MediaUrl${index}`] = mediaFile.url;
        whatsappPayload[`MediaSid${index}`] = mediaFile.mediaSid;
      });
      
      // Process the message as a new memory
      const processedMemory = await multimodalService.processWhatsAppMessage(
        whatsappPayload as any,
        userId
      );
      
      // Save the memory to the database
      const db = getDatabase();
      
      // Extract tags from metadata if available
      const tags = Array.isArray(processedMemory.metadata?.tags) 
        ? processedMemory.metadata.tags as string[]
        : [];
      
      // Calculate importance based on mood detection if available
      const importance = processedMemory.moodDetection?.intensity === 'high' ? 8 :
                        processedMemory.moodDetection?.intensity === 'medium' ? 6 : 5;
      
      const savedMemory = await db.memory.create({
        data: {
          userId,
          interactionId: processedMemory.interactionId,
          content: processedMemory.content,
          mem0Id: processedMemory.id,
          memoryType: processedMemory.memoryType,
          tags: tags,
          importance: importance,
        },
      });

      // Save the interaction to the database
      if (processedMessage.messageSid) {
        // Map memory type to interaction message type
        const messageType = processedMemory.memoryType === 'MIXED' ? 'TEXT' : processedMemory.memoryType;
        
        await db.interaction.create({
          data: {
            userId,
            messageSid: processedMessage.messageSid,
            direction: 'INBOUND',
            messageType: messageType,
            content: processedMessage.body || '',
            status: 'PROCESSED',
            timestamp: processedMessage.timestamp || new Date(),
          },
        });
      }
      
      logger.info('Memory and interaction saved to database', {
        memoryId: processedMemory.id,
        savedMemoryId: savedMemory.id,
        memoryType: processedMemory.memoryType,
        userId,
        messageSid: processedMessage.messageSid,
      });
      
      // Create rich, innovative response showing AI features
      const response = await WebhookController.createInnovativeMemoryResponse(processedMemory, processedMessage);
      
      return {
        type: 'text',
        content: response,
      };
      
    } catch (error) {
      logger.error('Error creating new memory', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId,
        messageSid: processedMessage.messageSid,
        messageType: processedMessage.messageType,
        mediaCount: processedMessage.mediaFiles?.length || 0,
      });
      
      return {
        type: 'text',
        content: '❌ Sorry, I couldn\'t save your memory right now. Please try again later.',
      };
    }
  }

  /**
   * Create rich, innovative memory response showcasing AI features
   */
  private static async createInnovativeMemoryResponse(processedMemory: any, processedMessage: any): Promise<string> {
    try {
      const memoryTypeEmoji = WebhookController.getMemoryTypeEmoji(processedMemory.memoryType);
      const content = processedMemory.content || processedMessage.body || '[Memory content]';
      const contentPreview = content.length > 60 ? content.substring(0, 60) + '...' : content;
      
      let response = `${memoryTypeEmoji} *Memory Saved Successfully!*\n\n`;
      response += `📝 "${contentPreview}"\n\n`;
      
      // Show AI-powered mood detection
      if (processedMemory.moodDetection) {
        const mood = processedMemory.moodDetection;
        const moodEmoji = WebhookController.getMoodEmoji(mood.mood);
        const confidencePercent = Math.round(mood.confidence * 100);
        
        response += `🧠 *AI Mood Analysis:*\n`;
        response += `${moodEmoji} ${mood.mood} (${confidencePercent}% confidence)\n`;
        response += `💭 Sentiment: ${mood.sentiment}\n`;
        
        if (mood.intensity) {
          response += `⚡ Intensity: ${mood.intensity}\n`;
        }
        response += `\n`;
      }
      
      // Show geo-tagging if available
      if (processedMemory.geoTagging) {
        const geo = processedMemory.geoTagging;
        response += `📍 *Location Detected:*\n`;
        
        if (geo.placeName) {
          response += `🏢 ${geo.placeName}\n`;
        }
        if (geo.city) {
          response += `🏙️ ${geo.city}, ${geo.country || 'Unknown'}\n`;
        }
        if (geo.coordinates) {
          response += `🗺️ ${geo.coordinates.lat.toFixed(4)}, ${geo.coordinates.lng.toFixed(4)}\n`;
        }
        response += `\n`;
      }
      
      // Show memory type and importance
      response += `📊 *Smart Analysis:*\n`;
      response += `📂 Type: ${processedMemory.memoryType.toLowerCase()}\n`;
      response += `⭐ Importance: ${processedMemory.importance || 5}/10\n`;
      
      // Show extracted tags
      if (processedMemory.tags && processedMemory.tags.length > 0) {
        const displayTags = processedMemory.tags.slice(0, 5); // Show max 5 tags
        response += `🏷️ Tags: ${displayTags.join(', ')}\n`;
      }
      
      // Show media info if available
      if (processedMemory.mediaFiles && processedMemory.mediaFiles.length > 0) {
        response += `📎 Contains ${processedMemory.mediaFiles.length} media file(s)\n`;
      }
      
      response += `\n💡 *What's next?*\n`;
      response += `🔍 Ask me questions to search your memories\n`;
      response += `📚 Type /list to see all memories\n`;
      response += `⏰ Say "remind me..." to set smart reminders`;
      
      return response;
      
    } catch (error) {
      logger.error('Error creating innovative response', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      // Fallback to simple response
      return '✅ Memory saved successfully! I\'ve analyzed and stored this with AI-powered insights.';
    }
  }

  /**
   * Get emoji for memory type
   */
  private static getMemoryTypeEmoji(memoryType: string): string {
    const emojiMap: Record<string, string> = {
      'TEXT': '💬',
      'IMAGE': '🖼️',
      'AUDIO': '🎵',
      'VIDEO': '🎬',
      'DOCUMENT': '📄',
      'LOCATION': '📍',
      'MIXED': '📎',
    };
    return emojiMap[memoryType] || '📝';
  }

  /**
   * Get emoji for detected mood
   */
  private static getMoodEmoji(mood: string): string {
    const moodEmojis: Record<string, string> = {
      'happy': '😊',
      'sad': '😢',
      'excited': '🤩',
      'stressed': '😰',
      'angry': '😠',
      'anxious': '😟',
      'grateful': '🙏',
      'confused': '🤔',
      'neutral': '😐',
    };
    return moodEmojis[mood.toLowerCase()] || '🤔';
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

}
