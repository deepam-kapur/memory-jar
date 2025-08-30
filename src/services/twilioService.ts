import twilio from 'twilio';
import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export interface TwilioWebhookPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body?: string;
  NumMedia: string;
  MediaUrl0?: string;
  MediaUrl1?: string;
  MediaUrl2?: string;
  MediaUrl3?: string;
  MediaUrl4?: string;
  MediaUrl5?: string;
  MediaUrl6?: string;
  MediaUrl7?: string;
  MediaUrl8?: string;
  MediaUrl9?: string;
  MediaContentType0?: string;
  MediaContentType1?: string;
  MediaContentType2?: string;
  MediaContentType3?: string;
  MediaContentType4?: string;
  MediaContentType5?: string;
  MediaContentType6?: string;
  MediaContentType7?: string;
  MediaContentType8?: string;
  MediaContentType9?: string;
  MediaSid0?: string;
  MediaSid1?: string;
  MediaSid2?: string;
  MediaSid3?: string;
  MediaSid4?: string;
  MediaSid5?: string;
  MediaSid6?: string;
  MediaSid7?: string;
  MediaSid8?: string;
  MediaSid9?: string;
  Timestamp: string;
  AccountSid: string;
}

export interface MediaFile {
  url: string;
  contentType: string;
  mediaSid: string;
  index: number;
}

export interface ProcessedMessage {
  messageSid: string;
  from: string;
  to: string;
  body?: string;
  messageType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT';
  mediaFiles: MediaFile[];
  timestamp: Date;
  accountSid: string;
}

export class TwilioService {
  private client: twilio.Twilio;
  private webhookSecret: string;

  constructor() {
    this.client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    this.webhookSecret = env.TWILIO_WEBHOOK_SECRET;
  }

  /**
   * Verify webhook signature to ensure request authenticity
   */
  verifyWebhookSignature(
    signature: string | undefined,
    url: string,
    params: Record<string, string>
  ): boolean {
    if (!signature) {
      logger.warn('No webhook signature provided');
      return false;
    }

    try {
      const expectedSignature = twilio.validateRequest(
        this.webhookSecret,
        signature,
        url,
        params
      );

      if (!expectedSignature) {
        logger.warn('Invalid webhook signature');
        return false;
      }

      logger.debug('Webhook signature verified successfully');
      return true;
    } catch (error) {
      logger.error('Error verifying webhook signature', { error });
      return false;
    }
  }

  /**
   * Process and validate incoming webhook payload
   */
  processWebhookPayload(payload: TwilioWebhookPayload): ProcessedMessage {
    // Validate required fields
    if (!payload.MessageSid || !payload.From || !payload.To) {
      throw new BadRequestError(
        'Missing required webhook fields: MessageSid, From, or To',
        ErrorCodes.INVALID_INPUT
      );
    }

    // Extract media files
    const mediaFiles: MediaFile[] = [];
    const numMedia = parseInt(payload.NumMedia, 10) || 0;

    for (let i = 0; i < numMedia && i < 10; i++) {
      const mediaUrl = payload[`MediaUrl${i}` as keyof TwilioWebhookPayload] as string;
      const contentType = payload[`MediaContentType${i}` as keyof TwilioWebhookPayload] as string;
      const mediaSid = payload[`MediaSid${i}` as keyof TwilioWebhookPayload] as string;

      if (mediaUrl && contentType && mediaSid) {
        mediaFiles.push({
          url: mediaUrl,
          contentType,
          mediaSid,
          index: i,
        });
      }
    }

    // Determine message type
    const messageType = this.determineMessageType(payload.Body, mediaFiles);

    // Parse timestamp
    const timestamp = new Date(parseInt(payload.Timestamp, 10) * 1000);

    const processedMessage: ProcessedMessage = {
      messageSid: payload.MessageSid,
      from: payload.From,
      to: payload.To,
      body: payload.Body,
      messageType,
      mediaFiles,
      timestamp,
      accountSid: payload.AccountSid,
    };

    logger.info('Processed webhook payload', {
      messageSid: processedMessage.messageSid,
      from: processedMessage.from,
      messageType: processedMessage.messageType,
      mediaCount: processedMessage.mediaFiles.length,
      timestamp: processedMessage.timestamp.toISOString(),
    });

    return processedMessage;
  }

  /**
   * Determine message type based on content and media
   */
  private determineMessageType(body?: string, mediaFiles: MediaFile[] = []): ProcessedMessage['messageType'] {
    if (mediaFiles.length === 0) {
      return 'TEXT';
    }

    // Check the first media file type (assuming single media per message for simplicity)
    const firstMedia = mediaFiles[0];
    if (!firstMedia) {
      return 'TEXT';
    }
    const contentType = firstMedia.contentType.toLowerCase();

    if (contentType.startsWith('image/')) {
      return 'IMAGE';
    } else if (contentType.startsWith('audio/')) {
      return 'AUDIO';
    } else if (contentType.startsWith('video/')) {
      return 'VIDEO';
    } else {
      return 'DOCUMENT';
    }
  }

  /**
   * Download media file from Twilio
   */
  async downloadMedia(mediaUrl: string): Promise<Buffer> {
    try {
      logger.debug('Downloading media from Twilio', { mediaUrl });

      // Twilio media URLs require authentication
      const response = await this.client.request({
        method: 'get',
        uri: mediaUrl,
        username: env.TWILIO_ACCOUNT_SID,
        password: env.TWILIO_AUTH_TOKEN,
      });

      if (!response.body) {
        throw new Error('Empty response body from Twilio media URL');
      }

      const buffer = Buffer.from(response.body, 'binary');
      
      logger.debug('Media downloaded successfully', {
        mediaUrl,
        size: buffer.length,
      });

      return buffer;
    } catch (error) {
      logger.error('Error downloading media from Twilio', {
        mediaUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new BadRequestError(
        `Failed to download media: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.TWILIO_ERROR
      );
    }
  }

  /**
   * Send WhatsApp message response
   */
  async sendWhatsAppMessage(to: string, body: string): Promise<void> {
    try {
      logger.info('Sending WhatsApp message', { to, bodyLength: body.length });

      await this.client.messages.create({
        body,
        from: env.TWILIO_WHATSAPP_NUMBER,
        to: `whatsapp:${to}`,
      });

      logger.info('WhatsApp message sent successfully', { to });
    } catch (error) {
      logger.error('Error sending WhatsApp message', {
        to,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new BadRequestError(
        `Failed to send WhatsApp message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.TWILIO_ERROR
      );
    }
  }

  /**
   * Get Twilio client instance (for advanced operations)
   */
  getClient(): twilio.Twilio {
    return this.client;
  }
}

// Export singleton instance (lazy initialization for tests)
let _twilioService: TwilioService | null = null;

export const twilioService = (): TwilioService => {
  if (!_twilioService) {
    _twilioService = new TwilioService();
  }
  return _twilioService;
};
