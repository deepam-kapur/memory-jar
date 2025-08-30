import { Request, Response } from 'express';
import { getDatabase } from '../services/database';
import { twilioService, type TwilioWebhookPayload } from '../services/twilioService';
import { MemoryController } from './memoryController';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export class WebhookController {
  /**
   * Handle incoming Twilio WhatsApp messages
   * POST /webhook
   */
  static async handleIncomingMessage(req: Request, res: Response) {
    try {
      // Step 1: Verify webhook signature for security
      const signature = req.headers['x-twilio-signature'] as string;
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      
      if (!twilioService().verifyWebhookSignature(signature, url, req.body)) {
        logger.warn('Invalid webhook signature', {
          signature: signature ? 'present' : 'missing',
          url,
          ip: req.ip,
        });
        throw new BadRequestError(
          'Invalid webhook signature',
          ErrorCodes.INSUFFICIENT_PERMISSIONS
        );
      }

      // Step 2: Process and validate webhook payload
      const payload = req.body as TwilioWebhookPayload;
      const processedMessage = twilioService().processWebhookPayload(payload);

      // Step 3: Check for existing interaction (idempotency)
      const db = getDatabase();
      const existingInteraction = await db.interaction.findUnique({
        where: { messageSid: processedMessage.messageSid },
      });

      if (existingInteraction) {
        logger.info('Duplicate webhook received, returning existing interaction', {
          messageSid: processedMessage.messageSid,
          interactionId: existingInteraction.id,
        });

        return res.status(200).json({
          success: true,
          message: 'Webhook already processed',
          messageSid: processedMessage.messageSid,
          interactionId: existingInteraction.id,
          processingStatus: 'already_processed',
        });
      }

      // Step 4: Get or create user from WhatsApp phone number
      const user = await this.getOrCreateUser(processedMessage.from);

      // Step 5: Create interaction record
      const interaction = await this.createInteraction(user.id, processedMessage);

      // Step 6: Create memory from interaction
      const memory = await this.createMemoryFromInteraction(user.id, interaction.id, processedMessage);

      // Step 7: Send acknowledgment response
      await twilioService().sendWhatsAppMessage(
        processedMessage.from,
        `✅ Memory saved! I've stored your ${processedMessage.messageType.toLowerCase()} message. You can search for it later.`
      );

      logger.info('Webhook processed successfully', {
        userId: user.id,
        interactionId: interaction.id,
        memoryId: memory.id,
        messageSid: processedMessage.messageSid,
        messageType: processedMessage.messageType,
      });

      return res.status(200).json({
        success: true,
        message: 'Webhook processed successfully',
        messageSid: processedMessage.messageSid,
        userId: user.id,
        interactionId: interaction.id,
        memoryId: memory.id,
        messageType: processedMessage.messageType,
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
   * Create memory from interaction
   */
  private static async createMemoryFromInteraction(
    userId: string,
    interactionId: string,
    processedMessage: any
  ) {
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
        if (processedMessage.mediaFiles.length > 0) {
          content += ` [Media: ${processedMessage.mediaFiles[0].url}]`;
        }
        break;
      case 'AUDIO':
        content = processedMessage.body || 'Audio message';
        if (processedMessage.mediaFiles.length > 0) {
          content += ` [Audio: ${processedMessage.mediaFiles[0].url}]`;
        }
        break;
      case 'VIDEO':
        content = processedMessage.body || 'Video message';
        if (processedMessage.mediaFiles.length > 0) {
          content += ` [Video: ${processedMessage.mediaFiles[0].url}]`;
        }
        break;
      case 'DOCUMENT':
        content = processedMessage.body || 'Document message';
        if (processedMessage.mediaFiles.length > 0) {
          content += ` [Document: ${processedMessage.mediaFiles[0].url}]`;
        }
        break;
      default:
        content = processedMessage.body || 'Message';
        memoryType = 'TEXT';
    }

    // Create memory using the MemoryController
    const memory = await MemoryController.createMemoryFromInteraction(
      userId,
      interactionId,
      content,
      memoryType,
      processedMessage.mediaFiles.map((f: any) => f.url)
    );

    return memory;
  }
}
