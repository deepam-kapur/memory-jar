import { getDatabase } from './database';
import { getMem0Service } from './mem0Service';
import { getLocalStorageService } from './localStorageService';
import { getImageProcessingService } from './imageProcessingService';
import { MediaService } from './mediaService';
import { TwilioWebhookPayload, MediaInfo } from './twilioService';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';
import crypto from 'crypto';

export interface MediaFileInfo {
  url: string;
  filename: string;
  contentType: string;
  originalUrl: string;
  buffer?: Buffer;
}

export interface ProcessedMemory {
  id: string;
  content: string;
  memoryType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'MIXED';
  mediaFiles: (string | MediaFileInfo)[];
  metadata: Record<string, any>;
  fingerprint: string;
  transcription?: string;
  userId?: string;
  interactionId?: string;
}

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
  private imageProcessingService = getImageProcessingService();

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
<<<<<<< Updated upstream
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
=======
  private async processTextMessage(payload: TwilioWebhookPayload, userId: string, interactionId?: string): Promise<ProcessedMemory> {
    const content = payload.Body || '';
    
    if (!content.trim()) {
      throw new BadRequestError('Text message cannot be empty', ErrorCodes.INVALID_INPUT);
    }

    // Create memory in Mem0
    const memoryId = await this.mem0Service.createMemory({
      content: { text: content },
      userId,
      interactionId,
      memoryType: 'TEXT',
      tags: this.extractTags(content),
      importance: this.calculateImportance(content),
    });

    return {
      id: memoryId,
      content,
      memoryType: 'TEXT',
      mediaFiles: [],
      metadata: {
        source: 'whatsapp',
        messageSid: payload.MessageSid,
        timestamp: new Date().toISOString(),
      },
      userId,
      interactionId,
    };
  }

  /**
   * Process image message with enhanced AI analysis
   */
  private async processImageMessage(payload: TwilioWebhookPayload, mediaInfo: MediaInfo[], userId: string, interactionId?: string): Promise<ProcessedMemory> {
    if (mediaInfo.length === 0) {
      throw new BadRequestError('No media found in image message', ErrorCodes.INVALID_INPUT);
    }

    const mediaFile = mediaInfo[0]; // Process first image
    if (!mediaFile) {
      throw new BadRequestError('Invalid media file', ErrorCodes.INVALID_INPUT);
    }

    // Download media buffer
    const mediaBuffer = await this.twilioService.downloadMedia(mediaFile.url);
    
    // Analyze image using enhanced AI processing
    const imageAnalysis = await this.imageProcessingService.analyzeImage(mediaBuffer, mediaFile.filename);
    
    // Generate image embedding for similarity search
    const imageEmbedding = await this.imageProcessingService.generateImageEmbedding(mediaBuffer);
    
    // Store media using local storage
    const storedFile = await this.localStorageService.storeFile(mediaBuffer, mediaFile.filename, 'image/jpeg');

    // Use AI-generated description if no caption provided
    const description = payload.Body || imageAnalysis.description;
    
    // Combine user-provided tags with AI-extracted tags
    const userTags = this.extractTags(payload.Body || '');
    const aiTags = imageAnalysis.tags || [];
    const combinedTags = [...new Set([...userTags, ...aiTags])]; // Remove duplicates

    // Create enhanced memory in Mem0
    const memoryId = await this.mem0Service.createMemory({
      content: { 
        text: description,
        imageUrl: storedFile.fileUrl,
        metadata: {
          imageAnalysis,
          embedding: imageEmbedding,
          aiGenerated: !payload.Body, // Flag if description was AI-generated
        }
      },
      userId,
      interactionId,
      memoryType: 'IMAGE',
      tags: combinedTags,
      importance: this.calculateImageImportance(description, imageAnalysis),
    });

    logger.info('Enhanced image processing completed', {
      memoryId,
      filename: mediaFile.filename,
      imageSize: mediaBuffer.length,
      aiDescription: imageAnalysis.description,
      detectedObjects: imageAnalysis.objects?.length || 0,
      extractedTags: aiTags.length,
      mood: imageAnalysis.mood,
      confidence: imageAnalysis.confidence
    });

    return {
      id: memoryId,
      content: description,
      memoryType: 'IMAGE',
      mediaFiles: [{
        url: storedFile.fileUrl,
        filename: mediaFile.filename,
        contentType: mediaFile.contentType,
        originalUrl: mediaFile.url,
        buffer: mediaBuffer // Pass the buffer for database record creation
      }],
      metadata: {
        source: 'whatsapp',
        messageSid: payload.MessageSid,
        mediaType: mediaFile.contentType,
        originalUrl: mediaFile.url,
        timestamp: new Date().toISOString(),
        mediaUrls: [storedFile.fileUrl],
        imageAnalysis,
        embedding: imageEmbedding,
        aiEnhanced: true,
      },
      userId,
      interactionId,
    };
  }

  /**
   * Process audio message with enhanced AI analysis
   */
  private async processAudioMessage(payload: TwilioWebhookPayload, mediaInfo: MediaInfo[], userId: string, interactionId?: string): Promise<ProcessedMemory> {
    if (mediaInfo.length === 0) {
      throw new BadRequestError('No media found in audio message', ErrorCodes.INVALID_INPUT);
    }
>>>>>>> Stashed changes

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
<<<<<<< Updated upstream
=======

    // Download media
    const mediaBuffer = await this.twilioService.downloadMedia(mediaFile.url);
    
    // Store audio file
    const storedFile = await this.localStorageService.storeFile(mediaBuffer, mediaFile.filename, 'audio/wav');
    
    // Enhanced transcription with metadata
    const audioAnalysis = await this.openaiService.transcribeAudioWithMetadata(mediaBuffer, mediaFile.filename);
    
    // Combine user-provided content with AI analysis
    const combinedContent = payload.Body 
      ? `${payload.Body}\n\n[Transcription: ${audioAnalysis.transcription}]`
      : audioAnalysis.transcription;
    
    // Combine extracted tags with AI keywords
    const userTags = this.extractTags(payload.Body || '');
    const aiKeywords = audioAnalysis.keywords || [];
    const combinedTags = [...new Set([...userTags, ...aiKeywords])]; // Remove duplicates
    
    // Create enhanced memory in Mem0
    const memoryId = await this.mem0Service.createMemory({
      content: { 
        text: audioAnalysis.transcription,
        audioUrl: storedFile.fileUrl,
        metadata: {
          audioAnalysis,
          enhancedTranscription: true,
        }
      },
      userId,
      interactionId,
      memoryType: 'AUDIO',
      tags: combinedTags,
      importance: this.calculateAudioImportance(audioAnalysis),
    });

    logger.info('Enhanced audio processing completed', {
      memoryId,
      filename: mediaFile.filename,
      audioSize: mediaBuffer.length,
      transcriptionLength: audioAnalysis.transcription.length,
      language: audioAnalysis.language,
      confidence: audioAnalysis.confidence,
      sentiment: audioAnalysis.sentiment,
      keywordsCount: aiKeywords.length,
      duration: audioAnalysis.duration
    });

    return {
      id: memoryId,
      content: combinedContent,
      memoryType: 'AUDIO',
      mediaFiles: [storedFile.fileUrl],
      metadata: {
        source: 'whatsapp',
        messageSid: payload.MessageSid,
        mediaType: mediaFile.contentType,
        originalUrl: mediaFile.url,
        transcription: audioAnalysis.transcription,
        timestamp: new Date().toISOString(),
        audioAnalysis,
        aiEnhanced: true,
      },
      userId,
      interactionId,
    };
>>>>>>> Stashed changes
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

  /**
   * Calculate importance for image memories based on AI analysis
   */
  private calculateImageImportance(description: string, imageAnalysis: any): number {
    let importance = this.calculateImportance(description);

    // Boost importance based on AI confidence
    if (imageAnalysis.confidence > 0.9) importance += 1;
    
    // Boost importance for people/faces
    if (imageAnalysis.objects?.some((obj: string) => ['person', 'people', 'face'].includes(obj.toLowerCase()))) {
      importance += 1;
    }

    // Boost importance for special occasions/events
    const eventTags = ['birthday', 'wedding', 'graduation', 'celebration', 'anniversary'];
    if (imageAnalysis.tags?.some((tag: string) => eventTags.includes(tag.toLowerCase()))) {
      importance += 2;
    }

    // Boost importance for positive emotions
    if (imageAnalysis.mood === 'happy' || imageAnalysis.mood === 'excited') {
      importance += 1;
    }

    return Math.min(importance, 10);
  }

  /**
   * Calculate importance for audio memories based on AI analysis
   */
  private calculateAudioImportance(audioAnalysis: any): number {
    let importance = this.calculateImportance(audioAnalysis.transcription);

    // Boost importance based on transcription confidence
    if (audioAnalysis.confidence && audioAnalysis.confidence > 0.9) importance += 1;

    // Boost importance for longer audio (more content)
    if (audioAnalysis.duration > 30) importance += 1; // > 30 seconds
    if (audioAnalysis.duration > 120) importance += 1; // > 2 minutes

    // Boost importance for positive sentiment
    if (audioAnalysis.sentiment === 'positive') importance += 1;

    // Boost importance for multiple speakers (meetings/conversations)
    if (audioAnalysis.speakers > 1) importance += 1;

    // Boost importance for meeting/appointment keywords
    const meetingKeywords = ['meeting', 'appointment', 'call', 'conference', 'discussion'];
    if (audioAnalysis.keywords?.some((keyword: string) => 
      meetingKeywords.includes(keyword.toLowerCase()))) {
      importance += 1;
    }

    return Math.min(importance, 10);
  }
}

let multimodalServiceInstance: MultimodalService | null = null;

export const getMultimodalService = (): MultimodalService => {
  if (!multimodalServiceInstance) {
    multimodalServiceInstance = new MultimodalService();
  }
  return multimodalServiceInstance;
};
