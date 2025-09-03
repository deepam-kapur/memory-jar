import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';
import { getMem0Service } from './mem0Service';
import { getTwilioService } from './twilioService';
import { getOpenAIService } from './openaiService';
import { getLocalStorageService } from './localStorageService';
import { getImageProcessingService } from './imageProcessingService';
import { MediaService } from './mediaService';
import { TwilioWebhookPayload, MediaInfo } from './twilioService';

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
  userId: string;
  interactionId?: string;
}

export class MultimodalService {
  private mem0Service = getMem0Service();
  private twilioService = getTwilioService();
  private openaiService = getOpenAIService();
  private localStorageService = getLocalStorageService();
  private imageProcessingService = getImageProcessingService();

  /**
   * Process incoming WhatsApp message and create memory
   */
  async processWhatsAppMessage(payload: TwilioWebhookPayload, userId: string, interactionId?: string): Promise<ProcessedMemory> {
    try {
      logger.info('Processing WhatsApp message', {
        messageSid: payload.MessageSid,
        userId,
        interactionId,
        numMedia: payload.NumMedia,
      });

      // Determine message type
      const messageType = this.twilioService.getMessageType(payload);
      
      // Extract media information
      const mediaInfo = this.twilioService.extractMediaInfo(payload);
      
      // Process based on message type
      let processedMemory: ProcessedMemory;

      switch (messageType) {
        case 'TEXT':
          processedMemory = await this.processTextMessage(payload, userId, interactionId);
          break;
        case 'IMAGE':
          processedMemory = await this.processImageMessage(payload, mediaInfo, userId, interactionId);
          break;
        case 'AUDIO':
          processedMemory = await this.processAudioMessage(payload, mediaInfo, userId, interactionId);
          break;
        case 'VIDEO':
          processedMemory = await this.processVideoMessage(payload, mediaInfo, userId, interactionId);
          break;
        case 'DOCUMENT':
          processedMemory = await this.processDocumentMessage(payload, mediaInfo, userId, interactionId);
          break;
        default:
          throw new BadRequestError(`Unsupported message type: ${messageType}`, ErrorCodes.INVALID_INPUT);
      }

      logger.info('WhatsApp message processed successfully', {
        memoryId: processedMemory.id,
        memoryType: processedMemory.memoryType,
        userId,
        interactionId,
      });

      return processedMemory;

    } catch (error) {
      logger.error('Error processing WhatsApp message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageSid: payload.MessageSid,
        userId,
        interactionId,
      });
      throw new BadRequestError(
        `Failed to process WhatsApp message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.MEM0_ERROR
      );
    }
  }

  /**
   * Process text message
   */
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

    const mediaFile = mediaInfo[0]; // Process first audio file
    if (!mediaFile) {
      throw new BadRequestError('Invalid media file', ErrorCodes.INVALID_INPUT);
    }

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
  }

  /**
   * Process video message
   */
  private async processVideoMessage(payload: TwilioWebhookPayload, mediaInfo: MediaInfo[], userId: string, interactionId?: string): Promise<ProcessedMemory> {
    if (mediaInfo.length === 0) {
      throw new BadRequestError('No media found in video message', ErrorCodes.INVALID_INPUT);
    }

    const mediaFile = mediaInfo[0]; // Process first video
    if (!mediaFile) {
      throw new BadRequestError('Invalid media file', ErrorCodes.INVALID_INPUT);
    }

    const description = payload.Body || '[Video memory]';

    // Download and store media
    const mediaBuffer = await this.twilioService.downloadMedia(mediaFile.url);
    const storedFile = await this.localStorageService.storeFile(mediaBuffer, mediaFile.filename, 'video/mp4');

    // Create memory in Mem0
    const memoryId = await this.mem0Service.createMemory({
      content: { 
        text: description,
        imageUrl: storedFile.fileUrl, // Store video path as imageUrl for now
      },
      userId,
      interactionId,
      memoryType: 'MIXED',
      tags: this.extractTags(description),
      importance: this.calculateImportance(description),
    });

    return {
      id: memoryId,
      content: description,
      memoryType: 'MIXED',
      mediaFiles: [storedFile.fileUrl],
      metadata: {
        source: 'whatsapp',
        messageSid: payload.MessageSid,
        mediaType: mediaFile.contentType,
        originalUrl: mediaFile.url,
        timestamp: new Date().toISOString(),
      },
      userId,
      interactionId,
    };
  }

  /**
   * Process document message
   */
  private async processDocumentMessage(payload: TwilioWebhookPayload, mediaInfo: MediaInfo[], userId: string, interactionId?: string): Promise<ProcessedMemory> {
    if (mediaInfo.length === 0) {
      throw new BadRequestError('No media found in document message', ErrorCodes.INVALID_INPUT);
    }

    const mediaFile = mediaInfo[0]; // Process first document
    if (!mediaFile) {
      throw new BadRequestError('Invalid media file', ErrorCodes.INVALID_INPUT);
    }

    const description = payload.Body || `[Document: ${mediaFile.filename}]`;

    // Download and store media
    const mediaBuffer = await this.twilioService.downloadMedia(mediaFile.url);
    const storedFile = await this.localStorageService.storeFile(mediaBuffer, mediaFile.filename, 'application/pdf');

    // Create memory in Mem0
    const memoryId = await this.mem0Service.createMemory({
      content: { 
        text: description,
        imageUrl: storedFile.fileUrl, // Store document path as imageUrl for now
      },
      userId,
      interactionId,
      memoryType: 'MIXED',
      tags: this.extractTags(description),
      importance: this.calculateImportance(description),
    });

    return {
      id: memoryId,
      content: description,
      memoryType: 'MIXED',
      mediaFiles: [storedFile.fileUrl],
      metadata: {
        source: 'whatsapp',
        messageSid: payload.MessageSid,
        mediaType: mediaFile.contentType,
        originalUrl: mediaFile.url,
        filename: mediaFile.filename,
        timestamp: new Date().toISOString(),
      },
      userId,
      interactionId,
    };
  }

  /**
   * Search memories using natural language query
   */
  async searchMemories(query: string, userId?: string, limit: number = 10): Promise<ProcessedMemory[]> {
    try {
      const searchResults = await this.mem0Service.searchMemories(query, userId, limit);
      
      const processedMemories: ProcessedMemory[] = searchResults.map(result => ({
        id: result.id,
        content: result.content,
        memoryType: result.metadata['memoryType'] || 'TEXT',
        mediaFiles: result.metadata['mediaFiles'] || [],
        metadata: result.metadata,
        userId: result.metadata['userId'] || '',
        interactionId: result.metadata['interactionId'],
      }));

      logger.info('Memories searched successfully', {
        query,
        resultsCount: processedMemories.length,
        userId,
        limit,
      });

      return processedMemories;

    } catch (error) {
      logger.error('Error searching memories', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query,
        userId,
      });
      throw new BadRequestError(
        `Failed to search memories: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.MEM0_ERROR
      );
    }
  }

  /**
   * Health check for multimodal service
   */
  async healthCheck(): Promise<{ status: string; details?: any }> {
    try {
      const mem0Health = await this.mem0Service.healthCheck();
      const twilioHealth = await this.twilioService.healthCheck();
      const openaiHealth = await this.openaiService.healthCheck();
      const storageHealth = await this.localStorageService.healthCheck();

      const allHealthy = [mem0Health, twilioHealth, openaiHealth, storageHealth].every(
        health => {
          if (typeof health === 'boolean') return health;
          if (typeof health === 'object' && health !== null) {
            return health.status === 'healthy';
          }
          return false;
        }
      );

      return {
        status: allHealthy ? 'healthy' : 'degraded',
        details: {
          mem0: mem0Health,
          twilio: twilioHealth,
          openai: openaiHealth,
          storage: storageHealth,
        },
      };

    } catch (error) {
      logger.error('Multimodal service health check failed', {
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
  private extractTags(content: string): string[] {
    const tags: string[] = [];
    
    // Extract hashtags
    const hashtags = content.match(/#\w+/g);
    if (hashtags) {
      tags.push(...hashtags.map(tag => tag.slice(1)));
    }

    // Extract common keywords
    const keywords = ['important', 'urgent', 'reminder', 'meeting', 'appointment', 'deadline'];
    const lowerContent = content.toLowerCase();
    keywords.forEach(keyword => {
      if (lowerContent.includes(keyword)) {
        tags.push(keyword);
      }
    });

    return tags;
  }

  private calculateImportance(content: string): number {
    // Simple importance calculation based on content characteristics
    let importance = 1;

    // Increase importance for longer content
    if (content.length > 100) importance += 1;
    if (content.length > 500) importance += 1;

    // Increase importance for urgent keywords
    const urgentKeywords = ['urgent', 'asap', 'emergency', 'important', 'critical'];
    const lowerContent = content.toLowerCase();
    urgentKeywords.forEach(keyword => {
      if (lowerContent.includes(keyword)) {
        importance += 2;
      }
    });

    // Cap importance at 10
    return Math.min(importance, 10);
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