import { getMem0Service, CreateMemoryOptions } from './mem0Service';
import { getOpenAIService } from './openaiService';
import { getMediaService } from './mediaService';
import { getDatabase } from './database';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export interface ProcessedMedia {
  type: 'image' | 'audio' | 'video' | 'document';
  url: string;
  fingerprint: string;
  metadata: Record<string, any>;
  transcript?: string;
  transcription?: {
    text: string;
    language?: string;
    duration?: number;
    confidence?: number;
  };
}

export interface MultimodalMemoryData {
  userId: string;
  interactionId: string;
  content: string;
  memoryType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'MIXED';
  mediaFiles: ProcessedMedia[];
  tags?: string[];
  importance?: number;
}

export class MultimodalService {
  private mem0Service = getMem0Service();
  private openaiService = getOpenAIService();
  private mediaService = getMediaService();
  private db = getDatabase();

  /**
   * Process multimodal content and create memories
   */
  async processMultimodalContent(data: MultimodalMemoryData): Promise<string> {
    try {
      logger.info('Processing multimodal content', {
        userId: data.userId,
        interactionId: data.interactionId,
        memoryType: data.memoryType,
        mediaCount: data.mediaFiles.length,
      });

      // Process media files
      const processedMedia = await this.processMediaFiles(data.mediaFiles);

      // Create memory content based on type
      let memoryContent = data.content;
      let mediaUrls: string[] = [];
      let metadata: Record<string, any> = {};

      // Process based on memory type
      switch (data.memoryType) {
        case 'TEXT':
          // Text-only memory
          break;

        case 'IMAGE':
          // Image memory - add image description
          if (processedMedia.length > 0) {
            const imageMedia = processedMedia.find(m => m.type === 'image');
            if (imageMedia) {
              memoryContent = `${data.content}\n[Image: ${imageMedia.url}]`;
              mediaUrls.push(imageMedia.url);
              metadata.imageMetadata = imageMedia.metadata;
            }
          }
          break;

        case 'AUDIO':
          // Audio memory - add transcription
          if (processedMedia.length > 0) {
            const audioMedia = processedMedia.find(m => m.type === 'audio');
            if (audioMedia && audioMedia.transcription) {
              memoryContent = `${data.content}\n[Audio Transcript: ${audioMedia.transcription.text}]`;
              mediaUrls.push(audioMedia.url);
              metadata.audioMetadata = {
                ...audioMedia.metadata,
                transcript: audioMedia.transcription.text,
                language: audioMedia.transcription.language,
                duration: audioMedia.transcription.duration,
                confidence: audioMedia.transcription.confidence,
              };
            }
          }
          break;

        case 'VIDEO':
          // Video memory - add video description
          if (processedMedia.length > 0) {
            const videoMedia = processedMedia.find(m => m.type === 'video');
            if (videoMedia) {
              memoryContent = `${data.content}\n[Video: ${videoMedia.url}]`;
              mediaUrls.push(videoMedia.url);
              metadata.videoMetadata = videoMedia.metadata;
            }
          }
          break;

        case 'MIXED':
          // Mixed memory - combine all media
          const mediaDescriptions: string[] = [];
          processedMedia.forEach(media => {
            mediaUrls.push(media.url);
            switch (media.type) {
              case 'image':
                mediaDescriptions.push(`[Image: ${media.url}]`);
                break;
              case 'audio':
                if (media.transcription) {
                  mediaDescriptions.push(`[Audio: ${media.transcription.text}]`);
                } else {
                  mediaDescriptions.push(`[Audio: ${media.url}]`);
                }
                break;
              case 'video':
                mediaDescriptions.push(`[Video: ${media.url}]`);
                break;
              case 'document':
                mediaDescriptions.push(`[Document: ${media.url}]`);
                break;
            }
          });
          memoryContent = `${data.content}\n${mediaDescriptions.join('\n')}`;
          metadata.mixedMedia = processedMedia.map(m => ({
            type: m.type,
            url: m.url,
            metadata: m.metadata,
            transcript: m.transcription?.text,
          }));
          break;
      }

      // Create memory in Mem0
      const mem0Options: CreateMemoryOptions = {
        content: {
          text: memoryContent,
          metadata: {
            ...metadata,
            mediaUrls,
            originalContent: data.content,
            memoryType: data.memoryType,
            interactionId: data.interactionId,
          },
        },
        userId: data.userId,
        interactionId: data.interactionId,
        memoryType: data.memoryType,
        tags: data.tags,
        importance: data.importance,
      };

      const mem0Id = await this.mem0Service.createMemory(mem0Options);

      logger.info('Multimodal memory created successfully', {
        mem0Id,
        userId: data.userId,
        interactionId: data.interactionId,
        memoryType: data.memoryType,
        contentLength: memoryContent.length,
        mediaCount: mediaUrls.length,
      });

      return mem0Id;
    } catch (error) {
      logger.error('Error processing multimodal content', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: data.userId,
        interactionId: data.interactionId,
        memoryType: data.memoryType,
      });
      throw new BadRequestError(
        `Failed to process multimodal content: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.INTERNAL_ERROR
      );
    }
  }

  /**
   * Process media files (download, transcribe, fingerprint)
   */
  private async processMediaFiles(mediaFiles: ProcessedMedia[]): Promise<ProcessedMedia[]> {
    const processedFiles: ProcessedMedia[] = [];

    for (const media of mediaFiles) {
      try {
        // Download and fingerprint media
        const fingerprint = await this.mediaService.generateFingerprint(media.url);
        
        // Check for duplicates
        const existingMedia = await this.mediaService.findMediaByFingerprint(fingerprint);
        if (existingMedia) {
          logger.info('Media duplicate found', {
            originalUrl: media.url,
            existingUrl: existingMedia.s3Url,
            fingerprint,
          });
          processedFiles.push({
            ...media,
            fingerprint,
            url: existingMedia.s3Url || media.url,
          });
          continue;
        }

        // Process based on media type
        let processedMedia: ProcessedMedia = {
          ...media,
          fingerprint,
        };

        // Transcribe audio files
        if (media.type === 'audio') {
          try {
            const transcription = await this.openaiService.transcribeAudioFromUrl(media.url);
            processedMedia.transcription = transcription;
            logger.info('Audio transcription completed', {
              url: media.url,
              textLength: transcription.text.length,
              language: transcription.language,
            });
          } catch (transcriptionError) {
            logger.warn('Audio transcription failed', {
              url: media.url,
              error: transcriptionError instanceof Error ? transcriptionError.message : 'Unknown error',
            });
            // Continue without transcription
          }
        }

        // Store media metadata
        await this.mediaService.storeMediaMetadata({
          userId: '', // Will be set by caller
          interactionId: '', // Will be set by caller
          memoryId: '', // Will be set by caller
          fileName: `media_${fingerprint}`,
          originalName: `media_${Date.now()}`,
          fileType: this.getFileTypeFromUrl(media.url),
          fileSize: 0, // Will be updated when we implement actual download
          s3Key: `media/${fingerprint}`,
          s3Url: media.url,
          fingerprint,
          transcription: processedMedia.transcription?.text,
          metadata: processedMedia.metadata,
        });

        processedFiles.push(processedMedia);
      } catch (error) {
        logger.error('Error processing media file', {
          url: media.url,
          type: media.type,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with other files
      }
    }

    return processedFiles;
  }

  /**
   * Get file type from URL
   */
  private getFileTypeFromUrl(url: string): string {
    const extension = url.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'mp4':
        return 'video/mp4';
      case 'avi':
        return 'video/avi';
      case 'mp3':
        return 'audio/mpeg';
      case 'wav':
        return 'audio/wav';
      case 'pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * Process Twilio webhook media
   */
  async processTwilioMedia(
    userId: string,
    interactionId: string,
    mediaUrls: string[],
    mediaTypes: string[]
  ): Promise<ProcessedMedia[]> {
    const processedMedia: ProcessedMedia[] = [];

    for (let i = 0; i < mediaUrls.length; i++) {
      const url = mediaUrls[i];
      const contentType = mediaTypes[i] || 'application/octet-stream';

      let type: 'image' | 'audio' | 'video' | 'document' = 'document';
      if (contentType.startsWith('image/')) type = 'image';
      else if (contentType.startsWith('audio/')) type = 'audio';
      else if (contentType.startsWith('video/')) type = 'video';

      processedMedia.push({
        type,
        url,
        fingerprint: '', // Will be generated
        metadata: {
          contentType,
          source: 'twilio',
          originalUrl: url,
        },
      });
    }

    return processedMedia;
  }
}

// Export singleton instance
let multimodalServiceInstance: MultimodalService | null = null;

export const getMultimodalService = (): MultimodalService => {
  if (!multimodalServiceInstance) {
    multimodalServiceInstance = new MultimodalService();
  }
  return multimodalServiceInstance;
};
