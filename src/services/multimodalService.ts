import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';
import { getMem0Service } from './mem0Service';
import { getTwilioService } from './twilioService';
import { getOpenAIService } from './openaiService';
import { getLocalStorageService } from './localStorageService';
import { TwilioWebhookPayload, MediaInfo } from './twilioService';

export interface ProcessedMemory {
  id: string;
  content: string;
  memoryType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'MIXED';
  mediaFiles: string[];
  metadata: Record<string, any>;
  userId: string;
  interactionId?: string;
}

export class MultimodalService {
  private mem0Service = getMem0Service();
  private twilioService = getTwilioService();
  private openaiService = getOpenAIService();
  private localStorageService = getLocalStorageService();

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
   * Process image message
   */
  private async processImageMessage(payload: TwilioWebhookPayload, mediaInfo: MediaInfo[], userId: string, interactionId?: string): Promise<ProcessedMemory> {
    if (mediaInfo.length === 0) {
      throw new BadRequestError('No media found in image message', ErrorCodes.INVALID_INPUT);
    }

    const mediaFile = mediaInfo[0]; // Process first image
    if (!mediaFile) {
      throw new BadRequestError('Invalid media file', ErrorCodes.INVALID_INPUT);
    }

    const description = payload.Body || '[Image memory]';

    // Download and store media
    const mediaBuffer = await this.twilioService.downloadMedia(mediaFile.url);
    const storedFile = await this.localStorageService.storeFile(mediaBuffer, mediaFile.filename, 'image/jpeg');

    // Create memory in Mem0
    const memoryId = await this.mem0Service.createMemory({
      content: { 
        text: description,
        imageUrl: storedFile.fileUrl,
      },
      userId,
      interactionId,
      memoryType: 'IMAGE',
      tags: this.extractTags(description),
      importance: this.calculateImportance(description),
    });

    return {
      id: memoryId,
      content: description,
      memoryType: 'IMAGE',
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
   * Process audio message
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
    
    // Transcribe audio using OpenAI Whisper
    const transcription = await this.openaiService.transcribeAudio(mediaBuffer, mediaFile.filename);
    
    // Create memory in Mem0
    const memoryId = await this.mem0Service.createMemory({
      content: { 
        text: transcription,
        audioUrl: storedFile.fileUrl,
      },
      userId,
      interactionId,
      memoryType: 'AUDIO',
      tags: this.extractTags(transcription),
      importance: this.calculateImportance(transcription),
    });

    return {
      id: memoryId,
      content: transcription,
      memoryType: 'AUDIO',
      mediaFiles: [storedFile.fileUrl],
      metadata: {
        source: 'whatsapp',
        messageSid: payload.MessageSid,
        mediaType: mediaFile.contentType,
        originalUrl: mediaFile.url,
        transcription: transcription,
        timestamp: new Date().toISOString(),
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
        health => health === true || (typeof health === 'object' && health.status === 'healthy')
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
}

let multimodalServiceInstance: MultimodalService | null = null;

export const getMultimodalService = (): MultimodalService => {
  if (!multimodalServiceInstance) {
    multimodalServiceInstance = new MultimodalService();
  }
  return multimodalServiceInstance;
};
