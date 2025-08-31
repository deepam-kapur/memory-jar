import { getDatabase } from './database';
import { getMem0Service } from './mem0Service';
import { getLocalStorageService } from './localStorageService';
import { getOpenAIService } from './openaiService';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';
import crypto from 'crypto';

export interface ProcessedMedia {
  url: string;
  type: string;
  metadata: Record<string, any>;
  fingerprint: string;
  transcription?: string;
}

export interface MultimodalContentOptions {
  userId: string;
  interactionId?: string;
  content: string;
  memoryType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'MIXED';
  mediaFiles: ProcessedMedia[];
  tags?: string[];
  importance?: number;
}

export class MultimodalService {
  private db = getDatabase();
  private mem0Service = getMem0Service();
  private localStorageService = getLocalStorageService();
  private openaiService = getOpenAIService();

  /**
   * Process multimodal content and create memory
   */
  async processMultimodalContent(options: MultimodalContentOptions): Promise<string> {
    try {
      const { userId, interactionId, content, memoryType, mediaFiles, tags, importance } = options;

      logger.info('Processing multimodal content', {
        userId,
        interactionId,
        memoryType,
        mediaFilesCount: mediaFiles.length,
        contentLength: content.length,
      });

      // Prepare content for Mem0
      const mem0Content = content;
      let imageUrl: string | undefined;
      let audioUrl: string | undefined;
      const metadata: Record<string, any> = {};

      // Process different media types
      if (mediaFiles.length > 0) {
        const imageMedia = mediaFiles.find(m => m.type.startsWith('image/'));
        const audioMedia = mediaFiles.find(m => m.type.startsWith('audio/'));
        const videoMedia = mediaFiles.find(m => m.type.startsWith('video/'));

        if (imageMedia) {
          imageUrl = imageMedia.url;
          metadata['imageMetadata'] = imageMedia.metadata;
        }

        if (audioMedia) {
          audioUrl = audioMedia.url;
          metadata['audioMetadata'] = {
            transcription: audioMedia.transcription,
            duration: audioMedia.metadata['duration'] || 'unknown',
            format: audioMedia.metadata['format'] || 'unknown',
          };
        }

        if (videoMedia) {
          metadata['videoMetadata'] = videoMedia.metadata;
        }

        // For mixed media, create a summary
        if (mediaFiles.length > 1) {
          metadata['mixedMedia'] = mediaFiles.map(m => ({
            type: m.type,
            url: m.url,
            fingerprint: m.fingerprint,
          }));
        }
      }

      // Create memory in Mem0
      const mem0Id = await this.mem0Service.createMemory({
        content: {
          text: mem0Content,
          imageUrl,
          audioUrl,
          metadata,
        },
        userId,
        interactionId,
        memoryType,
        tags,
        importance,
      });

      logger.info('Multimodal content processed successfully', {
        userId,
        interactionId,
        mem0Id,
        memoryType,
        hasImage: !!imageUrl,
        hasAudio: !!audioUrl,
      });

      return mem0Id;
    } catch (error) {
      logger.error('Error processing multimodal content', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: options.userId,
        memoryType: options.memoryType,
      });
      throw new BadRequestError(
        `Failed to process multimodal content: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.MEM0_ERROR
      );
    }
  }

  /**
   * Process Twilio media files
   */
  async processTwilioMedia(
    userId: string,
    interactionId: string,
    mediaUrls: string[],
    mediaTypes: string[]
  ): Promise<ProcessedMedia[]> {
    try {
      const processedMedia: ProcessedMedia[] = [];

      for (let i = 0; i < mediaUrls.length; i++) {
        const mediaUrl = mediaUrls[i];
        const mediaType = mediaTypes[i] || 'application/octet-stream';

        if (!mediaUrl) {
          logger.warn('Skipping empty media URL', { index: i });
          continue;
        }

        logger.info('Processing Twilio media', {
          userId,
          interactionId,
          mediaUrl,
          mediaType,
          index: i,
        });

        // Download and process media first to get fingerprint
        const mediaData = await this.downloadMediaFromTwilio(mediaUrl);
        const fingerprint = this.generateFingerprint(mediaData);
        
        // Check for existing media by fingerprint (deduplication)
        const existingMedia = await this.findExistingMedia(fingerprint);
        if (existingMedia) {
          logger.info('Found existing media, reusing', {
            fingerprint,
            existingMediaId: existingMedia.id,
          });
          
          processedMedia.push({
            url: existingMedia.s3Url,
            type: existingMedia.fileType,
            metadata: existingMedia.metadata as Record<string, any>,
            fingerprint: existingMedia.fingerprint,
            transcription: existingMedia.transcription || undefined,
          });
          continue;
        }
        
        // Store media locally
        const storedFile = await this.localStorageService.storeFile(mediaData, `media_${i}`, mediaType);
        
        let transcription: string | undefined;
        const metadata: Record<string, any> = {
          originalUrl: mediaUrl,
          storedAt: new Date().toISOString(),
          fileSize: mediaData.length,
          format: mediaType,
        };

        // Process based on media type
        if (mediaType.startsWith('audio/')) {
          const transcriptionResult = await this.openaiService.transcribeAudio(mediaData);
          transcription = transcriptionResult.text;
          metadata['transcription'] = transcription;
          metadata['duration'] = 'unknown'; // Could be extracted from audio file
        } else if (mediaType.startsWith('image/')) {
          metadata['dimensions'] = 'unknown'; // Could be extracted from image
        } else if (mediaType.startsWith('video/')) {
          metadata['duration'] = 'unknown'; // Could be extracted from video
        }

        // Store metadata in database
        await this.storeMediaMetadata({
          userId,
          interactionId,
          fileName: storedFile.fileName,
          originalName: storedFile.originalName,
          fileType: mediaType,
          fileSize: mediaData.length,
          s3Key: storedFile.fileName,
          s3Url: storedFile.fileUrl,
          fingerprint,
          transcription,
          metadata,
        });

        processedMedia.push({
          url: storedFile.fileUrl,
          type: mediaType,
          metadata,
          fingerprint,
          transcription,
        });
      }

      logger.info('Twilio media processing completed', {
        userId,
        interactionId,
        processedCount: processedMedia.length,
      });

      return processedMedia;
    } catch (error) {
      logger.error('Error processing Twilio media', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        interactionId,
        mediaUrls,
      });
      throw new BadRequestError(
        `Failed to process Twilio media: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.LOCAL_STORAGE_ERROR
      );
    }
  }

  /**
   * Find existing media by fingerprint
   */
  private async findExistingMedia(fingerprint: string): Promise<any> {
    return await this.db.mediaFile.findUnique({
      where: { fingerprint },
    });
  }

  /**
   * Store media metadata in database
   */
  private async storeMediaMetadata(data: {
    userId: string;
    interactionId?: string;
    fileName: string;
    originalName: string;
    fileType: string;
    fileSize: number;
    s3Key: string;
    s3Url: string;
    fingerprint: string;
    transcription?: string;
    metadata: Record<string, any>;
  }): Promise<any> {
    return await this.db.mediaFile.create({
      data: {
        userId: data.userId,
        interactionId: data.interactionId,
        fileName: data.fileName,
        originalName: data.originalName,
        fileType: data.fileType,
        fileSize: data.fileSize,
        s3Key: data.s3Key,
        s3Url: data.s3Url,
        fingerprint: data.fingerprint,
        transcription: data.transcription,
        metadata: data.metadata,
      },
    });
  }

  /**
   * Download media from Twilio URL
   */
  private async downloadMediaFromTwilio(mediaUrl: string): Promise<Buffer> {
    try {
      // For now, return a mock buffer since we don't have fetch in Node.js
      // In production, you would use a proper HTTP client like axios or node-fetch
      logger.info('Mock media download from Twilio', { mediaUrl });
      return Buffer.from('mock media content');
    } catch (error) {
      logger.error('Error downloading media from Twilio', { mediaUrl, error });
      throw new BadRequestError(
        `Failed to download media from Twilio: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.LOCAL_STORAGE_ERROR
      );
    }
  }

  /**
   * Generate SHA-256 fingerprint for media content
   */
  private generateFingerprint(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

let multimodalServiceInstance: MultimodalService | null = null;

export const getMultimodalService = (): MultimodalService => {
  if (!multimodalServiceInstance) {
    multimodalServiceInstance = new MultimodalService();
  }
  return multimodalServiceInstance;
};
