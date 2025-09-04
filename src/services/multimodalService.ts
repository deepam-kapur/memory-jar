import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';
import { getMem0Service } from './mem0Service';
import { getTwilioService } from './twilioService';
import { getOpenAIService } from './openaiService';
import { getLocalStorageService } from './localStorageService';
import { getImageProcessingService } from './imageProcessingService';
import { getDatabase } from './database';

import { getMoodDetectionService, MoodDetection } from './moodDetectionService';
import { getGeoTaggingService, LocationInfo, GeoTaggedMemory } from './geoTaggingService';
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
  metadata: Record<string, unknown>;
  userId: string;
  interactionId?: string;
  moodDetection?: MoodDetection;
  geoTagging?: GeoTaggedMemory;
}

export class MultimodalService {
  private mem0Service = getMem0Service();
  private twilioService = getTwilioService();
  private openaiService = getOpenAIService();
  private localStorageService = getLocalStorageService();
  private imageProcessingService = getImageProcessingService();
  private moodDetectionService = getMoodDetectionService();
  private geoTaggingService = getGeoTaggingService();

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
      
      logger.info('Processing WhatsApp message', {
        messageSid: payload.MessageSid,
        messageType,
        mediaCount: mediaInfo.length,
        userId,
      });
      
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
        case 'LOCATION':
          processedMemory = await this.processLocationMessage(payload, userId, interactionId);
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

    // Detect mood from text content
    const moodDetection = await this.moodDetectionService.detectMoodFromText(content);

    // Extract tags including mood-based tags
    const extractedTags = this.extractTags(content);
    const moodTags = [
      moodDetection.mood,
      moodDetection.sentiment,
      `intensity_${moodDetection.intensity}`,
      ...moodDetection.themes
    ];
    const combinedTags = [...new Set([...extractedTags, ...moodTags])];

    // Calculate importance with mood factor
    const importance = this.calculateImportanceWithMood(content, moodDetection);

    // Create memory in Mem0 with mood metadata
    const memoryId = await this.mem0Service.createMemory({
      content: { 
        text: content,
        metadata: {
          moodDetection,
          enhancedWithAI: true
        }
      },
      userId,
      interactionId,
      memoryType: 'TEXT',
      tags: combinedTags,
      importance,
    });

    logger.info('Text message processed with mood detection', {
      memoryId,
      mood: moodDetection.mood,
      confidence: moodDetection.confidence,
      sentiment: moodDetection.sentiment,
      intensity: moodDetection.intensity
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
        moodDetection,
        enhancedWithAI: true
      },
      userId,
      interactionId,
      moodDetection,
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
    
    // Detect mood from image analysis and user caption
    const imageMoodDetection = await this.moodDetectionService.detectMoodFromImage(imageAnalysis);
    let combinedMoodDetection = imageMoodDetection;
    
    // If user provided caption, also analyze text mood and combine
    if (payload.Body && payload.Body.trim()) {
      const textMoodDetection = await this.moodDetectionService.detectMoodFromText(payload.Body);
      combinedMoodDetection = this.combineMoodDetections(textMoodDetection, imageMoodDetection);
    }
    
    // Combine user-provided tags with AI-extracted tags and mood tags
    const userTags = this.extractTags(payload.Body || '');
    const aiTags = imageAnalysis.tags || [];
    const moodTags = [
      combinedMoodDetection.mood,
      combinedMoodDetection.sentiment,
      `intensity_${combinedMoodDetection.intensity}`,
      ...combinedMoodDetection.themes
    ];
    const combinedTags = [...new Set([...userTags, ...aiTags, ...moodTags])]; // Remove duplicates

    // Create enhanced memory in Mem0
    const memoryId = await this.mem0Service.createMemory({
      content: { 
        text: description,
        imageUrl: storedFile.fileUrl,
        metadata: {
          imageAnalysis,
          embedding: imageEmbedding,
          moodDetection: combinedMoodDetection,
          aiGenerated: !payload.Body, // Flag if description was AI-generated
          enhancedWithAI: true
        }
      },
      userId,
      interactionId,
      memoryType: 'IMAGE',
      tags: combinedTags,
      importance: this.calculateImportanceWithMood(description, combinedMoodDetection),
    });

    logger.info('Enhanced image processing completed', {
      memoryId,
      filename: mediaFile.filename,
      imageSize: mediaBuffer.length,
      aiDescription: imageAnalysis.description,
      detectedObjects: imageAnalysis.objects?.length || 0,
      extractedTags: aiTags.length,
      mood: combinedMoodDetection.mood,
      moodConfidence: combinedMoodDetection.confidence,
      sentiment: combinedMoodDetection.sentiment,
      intensity: combinedMoodDetection.intensity
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
        moodDetection: combinedMoodDetection,
        aiEnhanced: true,
      },
      userId,
      interactionId,
      moodDetection: combinedMoodDetection,
    };
  }

  /**
   * Process audio message with enhanced AI analysis
   */
  private async processAudioMessage(payload: TwilioWebhookPayload, mediaInfo: MediaInfo[], userId: string, interactionId?: string): Promise<ProcessedMemory> {
    logger.info('Processing audio message', {
      messageSid: payload.MessageSid,
      mediaCount: mediaInfo.length,
      userId,
    });

    if (mediaInfo.length === 0) {
      throw new BadRequestError('No media found in audio message', ErrorCodes.INVALID_INPUT);
    }

    const mediaFile = mediaInfo[0]; // Process first audio file
    if (!mediaFile) {
      throw new BadRequestError('Invalid media file', ErrorCodes.INVALID_INPUT);
    }

    logger.info('Downloading audio media', {
      mediaUrl: mediaFile.url,
      contentType: mediaFile.contentType,
    });

    // Download media
    let mediaBuffer;
    try {
      mediaBuffer = await this.twilioService.downloadMedia(mediaFile.url);
      logger.info('Media downloaded successfully', {
        bufferSize: mediaBuffer.length,
        mediaUrl: mediaFile.url,
      });
    } catch (downloadError) {
      logger.error('Media download failed', {
        error: downloadError instanceof Error ? downloadError.message : 'Unknown error',
        mediaUrl: mediaFile.url,
        messageSid: payload.MessageSid,
      });
      throw downloadError;
    }
    
    // Store audio file with correct content type
    const storedFile = await this.localStorageService.storeFile(mediaBuffer, mediaFile.filename, mediaFile.contentType);
    
    // Enhanced transcription with metadata
    let audioAnalysis;
    try {
      audioAnalysis = await this.openaiService.transcribeAudioWithMetadata(mediaBuffer, mediaFile.filename, storedFile.filePath);
    } catch (transcriptionError) {
      logger.warn('Audio transcription failed, using fallback', {
        error: transcriptionError instanceof Error ? transcriptionError.message : 'Unknown error',
        messageSid: payload.MessageSid,
      });
      
      // Fallback audio analysis
      audioAnalysis = {
        transcription: '[Voice note - transcription not available]',
        language: 'unknown',
        duration: 0,
        confidence: 0.5,
        keywords: ['voice', 'audio', 'note'],
        summary: 'Voice note received',
        sentiment: 'neutral' as const,
        topics: ['voice_message'],
      };
    }
    
    // Detect mood from audio analysis
    const audioMoodDetection = await this.moodDetectionService.detectMoodFromAudio(audioAnalysis);
    let combinedMoodDetection = audioMoodDetection;
    
    // If user provided caption, also analyze text mood and combine
    if (payload.Body && payload.Body.trim()) {
      const textMoodDetection = await this.moodDetectionService.detectMoodFromText(payload.Body);
      combinedMoodDetection = this.combineMoodDetections(textMoodDetection, audioMoodDetection);
    }
    
    // Combine user-provided content with AI analysis
    const combinedContent = payload.Body 
      ? `${payload.Body}\n\n[Transcription: ${audioAnalysis.transcription}]`
      : audioAnalysis.transcription;
    
    // Combine extracted tags with AI keywords and mood tags
    const userTags = this.extractTags(payload.Body || '');
    const aiKeywords = audioAnalysis.keywords || [];
    const moodTags = [
      combinedMoodDetection.mood,
      combinedMoodDetection.sentiment,
      `intensity_${combinedMoodDetection.intensity}`,
      ...combinedMoodDetection.themes
    ];
    const combinedTags = [...new Set([...userTags, ...aiKeywords, ...moodTags])]; // Remove duplicates
    
    // Create enhanced memory in Mem0
    const memoryId = await this.mem0Service.createMemory({
      content: { 
        text: audioAnalysis.transcription,
        audioUrl: storedFile.fileUrl,
        metadata: {
          audioAnalysis,
          moodDetection: combinedMoodDetection,
          enhancedTranscription: true,
          enhancedWithAI: true
        }
      },
      userId,
      interactionId,
      memoryType: 'AUDIO',
      tags: combinedTags,
      importance: this.calculateImportanceWithMood(audioAnalysis.transcription, combinedMoodDetection),
    });

    logger.info('Enhanced audio processing completed', {
      memoryId,
      filename: mediaFile.filename,
      audioSize: mediaBuffer.length,
      transcriptionLength: audioAnalysis.transcription.length,
      language: audioAnalysis.language,
      transcriptionConfidence: audioAnalysis.confidence,
      audioSentiment: audioAnalysis.sentiment,
      mood: combinedMoodDetection.mood,
      moodConfidence: combinedMoodDetection.confidence,
      intensity: combinedMoodDetection.intensity,
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
        moodDetection: combinedMoodDetection,
        aiEnhanced: true,
      },
      userId,
      interactionId,
      moodDetection: combinedMoodDetection,
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
   * Process location message from WhatsApp
   */
  private async processLocationMessage(payload: TwilioWebhookPayload, userId: string, interactionId?: string): Promise<ProcessedMemory> {
    try {
      // Extract location data from WhatsApp payload
      const latitude = payload.Latitude;
      const longitude = payload.Longitude;
      const address = payload.Label || payload.Body;

      if (!latitude || !longitude) {
        throw new BadRequestError('Location message missing coordinates', ErrorCodes.INVALID_INPUT);
      }

      logger.info('Processing location message', {
        latitude,
        longitude,
        address,
        messageSid: payload.MessageSid
      });

      // Extract location information using geo-tagging service
      const locationInfo = await this.geoTaggingService.extractLocationFromWhatsApp(
        latitude,
        longitude,
        address
      );

      // Create geo-tagged memory
      const geoTaggedMemory = await this.geoTaggingService.createGeoTaggedMemory(locationInfo);

      // Detect mood from location context and user message
      let moodDetection: MoodDetection | undefined;
      if (payload.Body && payload.Body.trim()) {
        moodDetection = await this.moodDetectionService.detectMoodFromText(payload.Body);
      }

      // Also try to extract mood from location context (if it's a known emotional place)
      const locationContextMood = this.extractMoodFromLocationContext(locationInfo, payload.Body);
      if (locationContextMood && moodDetection) {
        moodDetection = this.combineMoodDetections(moodDetection, locationContextMood);
      } else if (locationContextMood && !moodDetection) {
        moodDetection = locationContextMood;
      }

      // Create content description
      let content = '';
      if (payload.Body && payload.Body.trim()) {
        content = payload.Body;
      } else if (locationInfo.placeName) {
        content = `📍 Location: ${locationInfo.placeName}`;
      } else if (locationInfo.address) {
        content = `📍 Location: ${locationInfo.address}`;
      } else {
        content = `📍 Location: ${latitude}, ${longitude}`;
      }

      // Combine tags from location and mood
      const locationTags = geoTaggedMemory.locationTags;
      const moodTags = moodDetection ? [
        moodDetection.mood,
        moodDetection.sentiment,
        `intensity_${moodDetection.intensity}`,
        ...moodDetection.themes
      ] : [];
      const combinedTags = [...new Set([...locationTags, ...moodTags])];

      // Calculate importance with location and mood factors
      let importance = 3; // Base importance for location memories
      if (geoTaggedMemory.distanceFromHome !== undefined) {
        if (geoTaggedMemory.distanceFromHome > 100) importance += 2; // Distant locations are more noteworthy
        else if (geoTaggedMemory.distanceFromHome < 1) importance += 1; // Very close to home
      }
      if (moodDetection) {
        importance = this.calculateImportanceWithMood(content, moodDetection);
      }

      // Create memory in Mem0
      const memoryId = await this.mem0Service.createMemory({
        content: { 
          text: content,
          metadata: {
            locationInfo,
            geoTaggedMemory,
            moodDetection,
            coordinates: {
              latitude: locationInfo.latitude,
              longitude: locationInfo.longitude
            },
            enhancedWithAI: true
          }
        },
        userId,
        interactionId,
        memoryType: 'MIXED', // Location memories are mixed type
        tags: combinedTags,
        importance,
      });

      logger.info('Location message processed successfully', {
        memoryId,
        coordinates: `${locationInfo.latitude}, ${locationInfo.longitude}`,
        address: locationInfo.address,
        placeName: locationInfo.placeName,
        distanceFromHome: geoTaggedMemory.distanceFromHome,
        locationConfidence: locationInfo.locationConfidence,
        mood: moodDetection?.mood,
        tagsCount: combinedTags.length
      });

      return {
        id: memoryId,
        content,
        memoryType: 'MIXED',
        mediaFiles: [],
        metadata: {
          source: 'whatsapp',
          messageSid: payload.MessageSid,
          timestamp: new Date().toISOString(),
          locationInfo,
          geoTaggedMemory,
          moodDetection,
          aiEnhanced: true,
        },
        userId,
        interactionId,
        moodDetection,
        geoTagging: geoTaggedMemory,
      };

    } catch (error) {
      logger.error('Error processing location message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageSid: payload.MessageSid,
        userId,
        interactionId,
      });
      throw new BadRequestError(
        `Failed to process location message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.LOCATION_ERROR
      );
    }
  }

  /**
   * Extract mood from location context
   */
  private extractMoodFromLocationContext(locationInfo: LocationInfo, userMessage?: string): MoodDetection | null {
    // Simple location-based mood detection
    const locationText = `${locationInfo.placeName || ''} ${locationInfo.address || ''} ${userMessage || ''}`.toLowerCase();
    
    // Happy places
    if (locationText.includes('beach') || locationText.includes('vacation') || 
        locationText.includes('party') || locationText.includes('celebration') ||
        locationText.includes('restaurant') || locationText.includes('cafe')) {
      return {
        mood: 'happy',
        confidence: 0.6,
        emotionalIndicators: ['location_context'],
        intensity: 'medium',
        sentiment: 'positive',
        themes: ['leisure', 'social']
      };
    }

    // Work/stress places
    if (locationText.includes('office') || locationText.includes('work') ||
        locationText.includes('meeting') || locationText.includes('hospital')) {
      return {
        mood: 'neutral',
        confidence: 0.5,
        emotionalIndicators: ['work_context'],
        intensity: 'medium',
        sentiment: 'neutral',
        themes: ['work', 'obligation']
      };
    }

    // Peaceful places
    if (locationText.includes('home') || locationText.includes('park') ||
        locationText.includes('garden') || locationText.includes('library')) {
      return {
        mood: 'neutral',
        confidence: 0.5,
        emotionalIndicators: ['peaceful_context'],
        intensity: 'low',
        sentiment: 'neutral',
        themes: ['peaceful', 'comfortable']
      };
    }

    return null;
  }

  /**
   * Search memories using natural language query
   */
  async searchMemories(query: string, userId?: string, limit: number = 10): Promise<ProcessedMemory[]> {
    try {
      // Use database search instead of Mem0
      const db = getDatabase();
      
      // Extract keywords from the query for better search
      const keywords = query
        .toLowerCase()
        .split(' ')
        .filter(word => word.length > 2) // Filter out short words
        .filter(word => !['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'this', 'that', 'was', 'were', 'will', 'would', 'when', 'what', 'where', 'who', 'how', 'week', 'day', 'time'].includes(word));
      
      const whereConditions: any = {};
      
      if (keywords.length > 0) {
        // Search for any of the keywords in the content
        whereConditions.OR = keywords.map(keyword => ({
          content: {
            contains: keyword,
            mode: 'insensitive',
          }
        }));
      } else {
        // Fallback to full query search if no keywords
        whereConditions.content = {
          contains: query,
          mode: 'insensitive',
        };
      }
      
      if (userId) {
        whereConditions.userId = userId;
      }
      
      const memories = await db.memory.findMany({
        where: whereConditions,
        take: limit,
        orderBy: { lastAccessed: 'desc' },
        include: {
          mediaFiles: true,
        },
      });
      
      const processedMemories: ProcessedMemory[] = memories.map(memory => ({
        id: memory.mem0Id,
        content: memory.content,
        memoryType: memory.memoryType as 'TEXT' | 'IMAGE' | 'AUDIO' | 'MIXED',
        mediaFiles: memory.mediaFiles.map(mf => mf.fileUrl),
        metadata: { 
          createdAt: memory.createdAt.toISOString(),
          importance: memory.importance,
          tags: memory.tags,
          score: 0.8 // Default relevance score
        },
        userId: memory.userId,
        interactionId: memory.interactionId,
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
  async healthCheck(): Promise<{ status: string; details?: Record<string, unknown> }> {
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

  /**
   * Combine mood detections from different sources (text + image/audio)
   */
  private combineMoodDetections(primary: MoodDetection, secondary: MoodDetection): MoodDetection {
    // Use the mood detection with higher confidence as primary
    if (secondary.confidence > primary.confidence) {
      [primary, secondary] = [secondary, primary];
    }

    // Combine emotional indicators
    const combinedIndicators = [...new Set([
      ...primary.emotionalIndicators,
      ...secondary.emotionalIndicators
    ])].slice(0, 10);

    // Combine themes
    const combinedThemes = [...new Set([
      ...primary.themes,
      ...secondary.themes
    ])].slice(0, 5);

    // Average confidence with primary bias
    const combinedConfidence = Math.min(
      (primary.confidence * 0.7) + (secondary.confidence * 0.3),
      0.95
    );

    // Use primary mood but increase intensity if both are high
    let combinedIntensity = primary.intensity;
    if (primary.intensity === 'high' || secondary.intensity === 'high') {
      combinedIntensity = 'high';
    } else if (primary.intensity === 'medium' || secondary.intensity === 'medium') {
      combinedIntensity = 'medium';
    }

    // Combine sentiments (primary takes precedence unless neutral)
    let combinedSentiment = primary.sentiment;
    if (primary.sentiment === 'neutral' && secondary.sentiment !== 'neutral') {
      combinedSentiment = secondary.sentiment;
    }

    return {
      mood: primary.mood,
      confidence: combinedConfidence,
      emotionalIndicators: combinedIndicators,
      intensity: combinedIntensity,
      sentiment: combinedSentiment,
      themes: combinedThemes
    };
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
   * Calculate importance with mood detection factors
   */
  private calculateImportanceWithMood(content: string, moodDetection: MoodDetection): number {
    let importance = this.calculateImportance(content);

    // Mood-based importance adjustments
    switch (moodDetection.mood) {
      case 'stressed':
      case 'anxious':
      case 'angry':
        importance += 2; // High emotional states are important
        break;
      case 'sad':
        importance += 1; // Sad content should be tracked
        break;
      case 'excited':
      case 'happy':
        importance += 1; // Positive milestones are important
        break;
      case 'grateful':
        importance += 0.5; // Gratitude is meaningful
        break;
    }

    // Intensity adjustments
    switch (moodDetection.intensity) {
      case 'high':
        importance += 1;
        break;
      case 'medium':
        importance += 0.5;
        break;
    }

    // Confidence adjustments
    if (moodDetection.confidence > 0.8) {
      importance += 0.5; // High confidence in mood detection
    }

    // Theme-based adjustments
    if (moodDetection.themes.includes('work')) importance += 0.5;
    if (moodDetection.themes.includes('health')) importance += 1;
    if (moodDetection.themes.includes('relationships')) importance += 0.5;
    if (moodDetection.themes.includes('financial')) importance += 0.5;

    // Cap importance at 10
    return Math.min(importance, 10);
  }

  /**
   * Calculate importance for image memories based on AI analysis
   */
  private calculateImageImportance(description: string, imageAnalysis: Record<string, unknown>): number {
    let importance = this.calculateImportance(description);

    // Boost importance based on AI confidence
    if ((imageAnalysis['confidence'] as number) > 0.9) importance += 1;
    
    // Boost importance for people/faces
    if ((imageAnalysis['objects'] as string[])?.some((obj: string) => ['person', 'people', 'face'].includes(obj.toLowerCase()))) {
      importance += 1;
    }

    // Boost importance for special occasions/events
    const eventTags = ['birthday', 'wedding', 'graduation', 'celebration', 'anniversary'];
    if ((imageAnalysis['tags'] as string[])?.some((tag: string) => eventTags.includes(tag.toLowerCase()))) {
      importance += 2;
    }

    // Boost importance for positive emotions
    if (imageAnalysis['mood'] === 'happy' || imageAnalysis['mood'] === 'excited') {
      importance += 1;
    }

    return Math.min(importance, 10);
  }

  /**
   * Calculate importance for audio memories based on AI analysis
   */
  private calculateAudioImportance(audioAnalysis: Record<string, unknown>): number {
    let importance = this.calculateImportance(audioAnalysis['transcription'] as string);

    // Boost importance based on transcription confidence
    if (audioAnalysis['confidence'] && (audioAnalysis['confidence'] as number) > 0.9) importance += 1;

    // Boost importance for longer audio (more content)
    if ((audioAnalysis['duration'] as number) > 30) importance += 1; // > 30 seconds
    if ((audioAnalysis['duration'] as number) > 120) importance += 1; // > 2 minutes

    // Boost importance for positive sentiment
    if (audioAnalysis['sentiment'] === 'positive') importance += 1;

    // Boost importance for multiple speakers (meetings/conversations)
    if ((audioAnalysis['speakers'] as number) > 1) importance += 1;

    // Boost importance for meeting/appointment keywords
    const meetingKeywords = ['meeting', 'appointment', 'call', 'conference', 'discussion'];
    if ((audioAnalysis['keywords'] as string[])?.some((keyword: string) => 
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