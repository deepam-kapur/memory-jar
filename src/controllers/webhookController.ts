import { Request, Response } from 'express';
import { getDatabase } from '../services/database';
import { twilioService, type TwilioWebhookPayload } from '../services/twilioService';
import { MediaService } from '../services/mediaService';
import { getMultimodalService } from '../services/multimodalService';
import logger from '../config/logger';

export class WebhookController {
  /**
   * Handle incoming Twilio WhatsApp messages
   * POST /webhook
   */
  static async handleIncomingMessage(req: Request, res: Response) {
    try {
      
      // Temporarily disable signature verification for testing
      logger.debug('Development mode - skipping signature verification');

      // Step 2: Process and validate webhook payload
      const payload = req.body as TwilioWebhookPayload;
      const processedMessage = twilioService().processWebhookPayload(payload);

      // Step 3: Check for existing interaction (idempotency using MessageSid)
      const db = getDatabase();
      const existingInteraction = await db.interaction.findUnique({
        where: { messageSid: processedMessage.messageSid },
        include: {
          memories: true,
          mediaFiles: true,
        },
      });

      if (existingInteraction) {
        logger.info('Duplicate webhook received, returning existing interaction', {
          messageSid: processedMessage.messageSid,
          interactionId: existingInteraction.id,
          hasMemories: existingInteraction.memories.length > 0,
          hasMedia: existingInteraction.mediaFiles.length > 0,
        });

        return res.status(200).json({
          success: true,
          message: 'Webhook already processed',
          messageSid: processedMessage.messageSid,
          interactionId: existingInteraction.id,
          memoryCount: existingInteraction.memories.length,
          mediaCount: existingInteraction.mediaFiles.length,
          processingStatus: 'already_processed',
        });
      }

      // Step 4: Get or create user from WhatsApp phone number
      const user = await WebhookController.getOrCreateUser(processedMessage.from);

      // Step 5: Create interaction record
      const interaction = await WebhookController.createInteraction(user.id, processedMessage);

      // Step 6: Process media files with deduplication
      const mediaFiles = await WebhookController.processMediaFiles(user.id, interaction.id, processedMessage);

      // Step 7: Create memory from interaction
      const memory = await WebhookController.createMemoryFromInteraction(user.id, interaction.id, processedMessage, mediaFiles);

      // Step 8: Send acknowledgment response (disabled for testing)
      logger.debug('Skipping WhatsApp message sending in test mode');
      // await twilioService().sendWhatsAppMessage(
      //   processedMessage.from,
      //   `✅ Memory saved! I've stored your ${processedMessage.messageType.toLowerCase()} message${mediaFiles.length > 0 ? ` with ${mediaFiles.length} media file${mediaFiles.length > 1 ? 's' : ''}` : ''}. You can search for it later.`
      // );

      logger.info('Webhook processed successfully', {
        userId: user.id,
        interactionId: interaction.id,
        memoryId: memory.id,
        messageSid: processedMessage.messageSid,
        messageType: processedMessage.messageType,
        mediaCount: mediaFiles.length,
      });

      return res.status(200).json({
        success: true,
        message: 'Webhook processed successfully',
        messageSid: processedMessage.messageSid,
        userId: user.id,
        interactionId: interaction.id,
        memoryId: memory.id,
        messageType: processedMessage.messageType,
        mediaCount: mediaFiles.length,
        processingStatus: 'completed',
      });

    } catch (error) {
      logger.error('Error processing webhook', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Get or create user from WhatsApp phone number
   */
  private static async getOrCreateUser(phoneNumber: string) {
    const db = getDatabase();
    
    // Remove 'whatsapp:' prefix if present
    const cleanPhoneNumber = phoneNumber.replace('whatsapp:', '');
    
    // Try to find existing user
    let user = await db.user.findUnique({
      where: { phoneNumber: cleanPhoneNumber },
    });

    // Create user if they don't exist
    if (!user) {
      user = await db.user.create({
        data: {
          phoneNumber: cleanPhoneNumber,
          name: `WhatsApp User (${cleanPhoneNumber})`, // Default name
          isActive: true,
        },
      });

      logger.info('Created new user from WhatsApp', {
        userId: user.id,
        phoneNumber: cleanPhoneNumber,
      });
    }

    return user;
  }

  /**
   * Create interaction record for the message
   */
  private static async createInteraction(userId: string, processedMessage: any) {
    const db = getDatabase();

    // Create interaction record
    const interaction = await db.interaction.create({
      data: {
        userId,
        messageSid: processedMessage.messageSid, // Use MessageSid as dedup key for idempotency
        messageType: processedMessage.messageType,
        content: processedMessage.body || null,
        direction: 'INBOUND',
        status: 'PENDING', // Will be updated when memory is created
        metadata: {
          mediaFiles: processedMessage.mediaFiles,
          timestamp: processedMessage.timestamp.toISOString(),
          accountSid: processedMessage.accountSid,
          processedAt: new Date().toISOString(),
        },
      },
    });

    logger.info('Created interaction record', {
      interactionId: interaction.id,
      userId,
      messageType: processedMessage.messageType,
      hasContent: !!processedMessage.body,
      hasMedia: processedMessage.mediaFiles.length > 0,
    });

    return interaction;
  }

  /**
   * Process media files with deduplication
   */
  private static async processMediaFiles(
    userId: string,
    interactionId: string,
    processedMessage: any
  ) {
    const mediaFiles: any[] = [];

    for (const mediaFile of processedMessage.mediaFiles) {
      try {
        // Download and store media with deduplication
        const storedMedia = await MediaService.downloadAndStoreMedia(
          userId,
          mediaFile.url,
          mediaFile.contentType,
          `media_${mediaFile.mediaSid}`,
          interactionId
        );

        mediaFiles.push(storedMedia);

        logger.info('Processed media file with deduplication', {
          mediaId: storedMedia.id,
          fingerprint: storedMedia.fingerprint.substring(0, 8) + '...',
          isReference: storedMedia.metadata?.['isReference'] || false,
        });

      } catch (error) {
        logger.error('Error processing media file', {
          mediaUrl: mediaFile.url,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue processing other media files
      }
    }

    return mediaFiles;
  }

  /**
   * Create memory from interaction with multimodal processing
   */
  private static async createMemoryFromInteraction(
    userId: string,
    interactionId: string,
    processedMessage: any,
    mediaFiles: any[] = []
  ) {
    const multimodalService = getMultimodalService();
    
    // Determine content based on message type
    let content = processedMessage.body || '';
    let memoryType = processedMessage.messageType;

    // Handle different message types
    switch (processedMessage.messageType) {
      case 'TEXT':
        content = processedMessage.body || 'Text message';
        break;
      case 'IMAGE':
        content = processedMessage.body || 'Image message';
        break;
      case 'AUDIO':
        content = processedMessage.body || 'Audio message';
        break;
      case 'VIDEO':
        content = processedMessage.body || 'Video message';
        break;
      case 'DOCUMENT':
        content = processedMessage.body || 'Document message';
        break;
      default:
        content = processedMessage.body || 'Message';
        memoryType = 'TEXT';
    }

    // Process media files for multimodal processing
    const mediaUrls = mediaFiles.map(f => f.s3Url);
    const mediaTypes = mediaFiles.map(f => f.fileType);
    
    const processedMedia = await multimodalService.processTwilioMedia(
      userId,
      interactionId,
      mediaUrls,
      mediaTypes
    );

    // Create memory using multimodal service
    const mem0Id = await multimodalService.processMultimodalContent({
      userId,
      interactionId,
      content,
      memoryType: memoryType as any,
      mediaFiles: processedMedia,
      tags: [], // Will be enhanced with AI tagging in Phase 3
      importance: 1, // Default importance, will be enhanced in Phase 3
    });

    // Create memory in database with Mem0 ID
    const db = getDatabase();
    const memory = await db.memory.create({
      data: {
        userId,
        interactionId,
        content,
        memoryType: memoryType as any,
        tags: [],
        importance: 1,
        mem0Id,
      },
    });

    // Link media files to memory
    if (mediaFiles.length > 0) {
      await db.mediaFile.updateMany({
        where: {
          id: { in: mediaFiles.map(f => f.id) },
        },
        data: {
          memoryId: memory.id,
        },
      });
    }

    // Update interaction status
    await db.interaction.update({
      where: { id: interactionId },
      data: { status: 'PROCESSED' },
    });

    logger.info('Memory created from interaction with multimodal processing', {
      memoryId: memory.id,
      mem0Id,
      interactionId,
      userId,
      memoryType,
      mediaCount: mediaFiles.length,
    });

    return memory;
  }
}
