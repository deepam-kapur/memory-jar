import twilio from 'twilio';
import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';
import fetch from 'node-fetch';

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
  // Location message fields
  Latitude?: string;
  Longitude?: string;
  Label?: string;
}

export interface MediaFile {
  url: string;
  contentType: string;
  mediaSid: string;
  index: number;
}

export interface MediaInfo {
  url: string;
  filename: string;
  contentType: string;
}

export type MessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';

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
    // For testing, use a mock client if credentials are test values
    if (env.TWILIO_ACCOUNT_SID.startsWith('AC') && env.TWILIO_AUTH_TOKEN !== 'test_auth_token') {
      this.client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
      logger.debug('Twilio client initialized with real credentials', {
        accountSidPrefix: env.TWILIO_ACCOUNT_SID.substring(0, 8) + '...',
        hasAuthToken: !!env.TWILIO_AUTH_TOKEN
      });
    } else {
      // Mock client for testing
      logger.warn('Using mock Twilio client - media downloads may fail', {
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN
      });
      this.client = {} as twilio.Twilio;
    }
    this.webhookSecret = env.TWILIO_AUTH_TOKEN;
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

    // For testing, accept test signatures
    if (signature === 'test_signature' && env.TWILIO_AUTH_TOKEN === 'test_auth_token') {
      logger.debug('Test webhook signature accepted');
      return true;
    }

    // For testing, also accept any signature if we're using test credentials
    if (env.TWILIO_AUTH_TOKEN === 'test_auth_token') {
      logger.debug('Test environment - accepting webhook signature');
      return true;
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

      if (mediaUrl && contentType) {
        mediaFiles.push({
          url: mediaUrl,
          contentType,
          mediaSid: mediaSid || `generated_${payload.MessageSid}_${i}`,
          index: i,
        });
      }
    }

    // Determine message type
    const messageType = this.determineMessageType(payload.Body, mediaFiles);

    // Parse timestamp
            const timestamp = payload.Timestamp ? new Date(parseInt(payload.Timestamp, 10) * 1000) : new Date();

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
   * Download media file from Twilio (improved binary handling)
   */
  async downloadMedia(mediaUrl: string): Promise<Buffer> {
    try {
      logger.debug('Downloading media from Twilio with proper binary handling', { mediaUrl });

      // Use fetch for proper binary handling with authentication
      const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
      
      const response = await fetch(mediaUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      if (buffer.length === 0) {
        throw new Error('Downloaded file is empty');
      }

      const contentStart = buffer.subarray(0, 16).toString('ascii');
      
      // Check if response is XML metadata (Twilio returns metadata first)
      if (contentStart.includes('<?xml')) {
        logger.debug('Received Twilio metadata, following redirect to actual media', {
          mediaUrl,
          responseSize: buffer.length
        });

        // Parse the XML to extract the actual media URL
        const xmlContent = buffer.toString('utf8');
        const locationMatch = xmlContent.match(/<Location[^>]*>\s*([^<]+)\s*<\/Location>/i);
        
        if (!locationMatch || !locationMatch[1]) {
          logger.error('No location found in Twilio metadata', {
            mediaUrl,
            xmlContent: xmlContent.substring(0, 500)
          });
          throw new Error(`No media location found in Twilio response`);
        }

        const actualMediaUrl = locationMatch[1].trim();
        
        // Download the actual media from the redirect URL (no auth needed for direct URL)
        logger.debug('Downloading actual media from redirect URL', { actualMediaUrl });
        const mediaResponse = await fetch(actualMediaUrl, {
          method: 'GET',
        });

        if (!mediaResponse.ok) {
          throw new Error(`HTTP ${mediaResponse.status}: ${mediaResponse.statusText}`);
        }

        const mediaArrayBuffer = await mediaResponse.arrayBuffer();
        const mediaBuffer = Buffer.from(mediaArrayBuffer);
        
        if (mediaBuffer.length === 0) {
          throw new Error('Downloaded media file is empty');
        }

        const mediaContentStart = mediaBuffer.subarray(0, 16).toString('ascii');
        const mediaContentHex = mediaBuffer.subarray(0, 16).toString('hex');

        // Verify we got actual media content
        if (mediaContentStart.includes('<?xml') || mediaContentStart.includes('<Error>')) {
          const errorContent = mediaBuffer.toString('utf8');
          logger.error('Redirect URL also returned XML error', {
            actualMediaUrl,
            errorContent: errorContent.substring(0, 500)
          });
          throw new Error(`Media redirect failed: ${errorContent}`);
        }

        // Detect actual audio format
        const magic = mediaBuffer.subarray(0, 4).toString('hex');
        let detectedFormat = 'unknown';
        if (magic.startsWith('4f676753')) {
          detectedFormat = 'OGG';
        } else if (magic.startsWith('52494646')) {
          detectedFormat = 'WAV';
        } else if (magic.startsWith('494433') || magic.startsWith('fff3') || magic.startsWith('fff2')) {
          detectedFormat = 'MP3';
        }

        // Validate minimum file size (audio files should be larger than this)
        if (mediaBuffer.length < 100) {
          logger.warn('Downloaded media file is suspiciously small', {
            size: mediaBuffer.length,
            actualMediaUrl
          });
        }

        logger.info('Actual media downloaded successfully with proper binary handling', {
          originalUrl: mediaUrl,
          actualUrl: actualMediaUrl,
          size: mediaBuffer.length,
          contentStart: mediaContentStart.replace(/[^\x20-\x7E]/g, '.'), // Safe logging of binary content
          contentHex: mediaContentHex,
          detectedFormat,
          magicBytes: magic
        });

        return mediaBuffer;
      }
      
      // If it's not XML, assume it's already the media content
      const contentHex = buffer.subarray(0, 16).toString('hex');
      
      // Detect actual audio format
      const magic = buffer.subarray(0, 4).toString('hex');
      let detectedFormat = 'unknown';
      if (magic.startsWith('4f676753')) {
        detectedFormat = 'OGG';
      } else if (magic.startsWith('52494646')) {
        detectedFormat = 'WAV';
      } else if (magic.startsWith('494433') || magic.startsWith('fff3') || magic.startsWith('fff2')) {
        detectedFormat = 'MP3';
      }
      
      // Validate minimum file size (audio files should be larger than this)
      if (buffer.length < 100) {
        logger.warn('Downloaded media file is suspiciously small', {
          size: buffer.length,
          mediaUrl
        });
      }

      logger.info('Direct media downloaded successfully with proper binary handling', {
        mediaUrl,
        size: buffer.length,
        contentStart: contentStart.replace(/[^\x20-\x7E]/g, '.'), // Safe logging of binary content
        contentHex,
        detectedFormat,
        magicBytes: magic,
        isValidMedia: !contentStart.includes('<?xml')
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
   * Get message type based on payload
   */
  getMessageType(payload: TwilioWebhookPayload): MessageType {
    // Check for location message first
    if (payload.Latitude && payload.Longitude) {
      return 'LOCATION';
    }
    
    const numMedia = parseInt(payload.NumMedia || '0');
    
    if (numMedia === 0) {
      return 'TEXT';
    }
    
    // Check first media type
    const contentType = payload.MediaContentType0;
    if (contentType?.startsWith('image/')) {
      return 'IMAGE';
    } else if (contentType?.startsWith('audio/')) {
      return 'AUDIO';
    } else if (contentType?.startsWith('video/')) {
      return 'VIDEO';
    } else {
      return 'DOCUMENT';
    }
  }

  /**
   * Get file extension from content type
   */
  private getExtensionFromContentType(contentType: string): string {
    const contentTypeMap: Record<string, string> = {
      // Audio formats (OpenAI Whisper compatible)
      'audio/mpeg': 'mp3',    // ✅ Supported
      'audio/mp3': 'mp3',     // ✅ Supported
      'audio/wav': 'wav',     // ✅ Supported
      'audio/mp4': 'm4a',     // ✅ Supported
      'audio/webm': 'webm',   // ✅ Supported
      'audio/flac': 'flac',   // ✅ Supported
      'audio/ogg': 'ogg',     // ✅ Use OGG extension for OGG content
      'audio/aac': 'aac',     // ⚠️ Will need fallback
      // Image formats
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      // Video formats
      'video/mp4': 'mp4',
      'video/avi': 'avi',
      'video/mov': 'mov',
      'video/webm': 'webm',
      // Document formats
      'application/pdf': 'pdf',
      'text/plain': 'txt',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    };

    return contentTypeMap[contentType.toLowerCase()] || 'bin';
  }

  /**
   * Extract media information from payload
   */
  extractMediaInfo(payload: TwilioWebhookPayload): MediaInfo[] {
    const numMedia = parseInt(payload.NumMedia || '0');
    const mediaInfo: MediaInfo[] = [];
    
    for (let i = 0; i < numMedia; i++) {
      const url = payload[`MediaUrl${i}` as keyof TwilioWebhookPayload] as string;
      const contentType = payload[`MediaContentType${i}` as keyof TwilioWebhookPayload] as string;
      
      if (url && contentType) {
        // Generate filename with proper extension based on content type
        const extension = this.getExtensionFromContentType(contentType);
        mediaInfo.push({
          url,
          filename: `media_${i}_${Date.now()}.${extension}`,
          contentType,
        });
      }
    }
    
    return mediaInfo;
  }

  /**
   * Health check for Twilio service
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      // Try to fetch account info to verify connectivity
      await this.client.api.accounts(this.client.accountSid).fetch();
      return {
        status: 'healthy',
        message: 'Twilio service is operational',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Twilio service error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
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

// Legacy export for backwards compatibility
export const getTwilioService = twilioService;
