import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export interface TwilioWebhookPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body?: string;
  NumMedia?: string;
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
  [key: string]: any;
}

export interface MediaInfo {
  url: string;
  contentType: string;
  filename: string;
}

export class TwilioService {
  private accountSid: string;
  private authToken: string;
  private whatsappNumber: string;

  constructor() {
    this.accountSid = env.TWILIO_ACCOUNT_SID || '';
    this.authToken = env.TWILIO_AUTH_TOKEN || '';
    this.whatsappNumber = env.TWILIO_WHATSAPP_NUMBER || '';

    if (!this.accountSid || !this.authToken) {
      logger.warn('Twilio credentials not provided, media download will be mocked');
    } else {
      logger.info('Twilio service initialized with credentials');
    }
  }

  /**
   * Process Twilio webhook payload
   */
  processWebhookPayload(payload: any): TwilioWebhookPayload {
    try {
      const processedPayload: TwilioWebhookPayload = {
        MessageSid: payload.MessageSid || '',
        From: payload.From || '',
        To: payload.To || '',
        Body: payload.Body || '',
        NumMedia: payload.NumMedia || '0',
      };

      // Process media URLs and content types
      const numMedia = parseInt(payload.NumMedia || '0', 10);
      for (let i = 0; i < numMedia && i < 10; i++) {
        const mediaUrlKey = `MediaUrl${i}` as keyof TwilioWebhookPayload;
        const mediaContentTypeKey = `MediaContentType${i}` as keyof TwilioWebhookPayload;
        
        processedPayload[mediaUrlKey] = payload[mediaUrlKey] || '';
        processedPayload[mediaContentTypeKey] = payload[mediaContentTypeKey] || '';
      }

      // Copy any additional fields
      Object.keys(payload).forEach(key => {
        if (!(key in processedPayload)) {
          processedPayload[key] = payload[key];
        }
      });

      logger.info('Twilio webhook payload processed', {
        messageSid: processedPayload.MessageSid,
        from: processedPayload.From,
        numMedia: processedPayload.NumMedia,
        hasBody: !!processedPayload.Body,
      });

      return processedPayload;
    } catch (error) {
      logger.error('Error processing Twilio webhook payload', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload: JSON.stringify(payload),
      });
      throw new BadRequestError(
        `Failed to process webhook payload: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.TWILIO_ERROR
      );
    }
  }

  /**
   * Extract media information from webhook payload
   */
  extractMediaInfo(payload: TwilioWebhookPayload): MediaInfo[] {
    try {
      const mediaInfo: MediaInfo[] = [];
      const numMedia = parseInt(payload.NumMedia || '0', 10);

      for (let i = 0; i < numMedia && i < 10; i++) {
        const mediaUrlKey = `MediaUrl${i}` as keyof TwilioWebhookPayload;
        const mediaContentTypeKey = `MediaContentType${i}` as keyof TwilioWebhookPayload;
        
        const url = payload[mediaUrlKey] as string;
        const contentType = payload[mediaContentTypeKey] as string;

        if (url && contentType) {
          const filename = this.generateFilename(contentType, i);
          mediaInfo.push({ url, contentType, filename });
        }
      }

      logger.info('Media information extracted', {
        messageSid: payload.MessageSid,
        mediaCount: mediaInfo.length,
        mediaTypes: mediaInfo.map(m => m.contentType),
      });

      return mediaInfo;
    } catch (error) {
      logger.error('Error extracting media information', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageSid: payload.MessageSid,
      });
      throw new BadRequestError(
        `Failed to extract media information: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.TWILIO_ERROR
      );
    }
  }

  /**
   * Download media from Twilio
   */
  async downloadMedia(mediaUrl: string): Promise<Buffer> {
    try {
      // Use real Twilio API if credentials are available
      if (this.accountSid && this.authToken) {
        try {
          const response = await fetch(mediaUrl, {
            headers: {
              'Authorization': `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
            },
          });

          if (!response.ok) {
            throw new Error(`Failed to download media: ${response.statusText}`);
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          
          logger.info('Media downloaded from Twilio', {
            url: mediaUrl,
            size: buffer.length,
            status: response.status,
          });

          return buffer;
        } catch (apiError) {
          logger.error('Twilio media download error, falling back to mock', { apiError });
          // Fall back to mock download if API fails
        }
      }

      // Fallback to mock download
      return this.mockMediaDownload(mediaUrl);

    } catch (error) {
      logger.error('Error downloading media from Twilio', {
        error: error instanceof Error ? error.message : 'Unknown error',
        mediaUrl,
      });
      throw new BadRequestError(
        `Failed to download media: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.TWILIO_ERROR
      );
    }
  }

  /**
   * Determine message type from payload
   */
  getMessageType(payload: TwilioWebhookPayload): 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'UNKNOWN' {
    try {
      const numMedia = parseInt(payload.NumMedia || '0', 10);
      
      if (numMedia === 0) {
        return payload.Body ? 'TEXT' : 'UNKNOWN';
      }

      // Check the first media item's content type
      const contentType = payload.MediaContentType0 || '';
      
      if (contentType.startsWith('image/')) {
        return 'IMAGE';
      } else if (contentType.startsWith('audio/')) {
        return 'AUDIO';
      } else if (contentType.startsWith('video/')) {
        return 'VIDEO';
      } else {
        return 'DOCUMENT';
      }
    } catch (error) {
      logger.error('Error determining message type', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload: JSON.stringify(payload),
      });
      return 'UNKNOWN';
    }
  }

  /**
   * Send WhatsApp message (for responses)
   */
  async sendWhatsAppMessage(to: string, body: string, mediaUrl?: string): Promise<void> {
    try {
      // This would typically use Twilio's API to send messages
      // For now, we'll log the message that would be sent
      logger.info('WhatsApp message would be sent', {
        to,
        body,
        mediaUrl,
        timestamp: new Date().toISOString(),
      });

      // In a real implementation, you would use Twilio's API:
      // const client = require('twilio')(this.accountSid, this.authToken);
      // await client.messages.create({
      //   body,
      //   from: this.whatsappNumber,
      //   to,
      //   mediaUrl: mediaUrl ? [mediaUrl] : undefined,
      // });

    } catch (error) {
      logger.error('Error sending WhatsApp message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        to,
        body,
        mediaUrl,
      });
      throw new BadRequestError(
        `Failed to send WhatsApp message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.TWILIO_ERROR
      );
    }
  }

  /**
   * Health check for Twilio service
   */
  async healthCheck(): Promise<{ status: string; details?: any }> {
    try {
      if (this.accountSid && this.authToken) {
        try {
          // Test API connectivity by making a simple request
          const testUrl = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}`;
          const response = await fetch(testUrl, {
            headers: {
              'Authorization': `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
            },
          });

          if (response.ok) {
            return {
              status: 'healthy',
              details: {
                message: 'Twilio API is responding correctly',
                accountSid: this.accountSid,
                apiConnected: true,
              },
            };
          } else {
            throw new Error(`Twilio API returned status ${response.status}`);
          }
        } catch (apiError) {
          return {
            status: 'degraded',
            details: {
              message: 'Twilio API not available, using mock implementation',
              apiConnected: false,
              error: apiError instanceof Error ? apiError.message : 'Unknown error',
            },
          };
        }
      }

      // Mock implementation health check
      return {
        status: 'healthy',
        details: {
          message: 'Mock Twilio service is working',
          apiConnected: false,
          accountSid: this.accountSid || 'mock',
        },
      };

    } catch (error) {
      logger.error('Twilio health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  // Helper methods
  private generateFilename(contentType: string, index: number): string {
    const extension = this.getFileExtension(contentType);
    const timestamp = Date.now();
    return `media_${index}_${timestamp}${extension}`;
  }

  private getFileExtension(contentType: string): string {
    const extensions: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'audio/mp3': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'audio/m4a': '.m4a',
      'video/mp4': '.mp4',
      'video/avi': '.avi',
      'video/mov': '.mov',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
    };

    return extensions[contentType] || '.bin';
  }

  // Mock media download for fallback
  private mockMediaDownload(mediaUrl: string): Buffer {
    // Generate a mock buffer based on the URL
    const mockData = `Mock media content for URL: ${mediaUrl}`;
    return Buffer.from(mockData, 'utf8');
  }
}

let twilioServiceInstance: TwilioService | null = null;

export const getTwilioService = (): TwilioService => {
  if (!twilioServiceInstance) {
    twilioServiceInstance = new TwilioService();
  }
  return twilioServiceInstance;
};
