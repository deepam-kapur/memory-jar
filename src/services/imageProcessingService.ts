import OpenAI from 'openai';
import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export interface ImageAnalysis {
  description: string;
  tags: string[];
  objects: string[];
  scene: string;
  mood: 'happy' | 'sad' | 'excited' | 'calm' | 'energetic' | 'peaceful' | 'neutral';
  colors: string[];
  confidence: number;
  categories: string[];
}

export interface ImageMetadata {
  analysis: ImageAnalysis;
  embedding?: number[];
  processedAt: string;
  model: string;
}

export class ImageProcessingService {
  private openai: OpenAI | null = null;
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = env.OPENAI_API_KEY;
    
    if (!this.apiKey) {
      logger.warn('OPENAI_API_KEY not provided, using mock image processing');
    } else {
      try {
        this.openai = new OpenAI({
          apiKey: this.apiKey,
        });
        logger.info('Image Processing service initialized with OpenAI');
      } catch (error) {
        logger.error('Failed to initialize OpenAI for image processing', { error });
        this.openai = null;
      }
    }
  }

  /**
   * Analyze image using OpenAI GPT-4 Vision
   */
  async analyzeImage(imageBuffer: Buffer, filename: string = 'image.jpg'): Promise<ImageAnalysis> {
    try {
      // Use real OpenAI API if available
      if (this.openai && this.apiKey) {
        try {
          // Convert buffer to base64
          const base64Image = imageBuffer.toString('base64');
          const mimeType = this.getMimeTypeFromFilename(filename);

          // Use GPT-4 Vision for comprehensive image analysis
          const response = await this.openai.chat.completions.create({
            model: 'gpt-4-vision-preview',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Analyze this image comprehensively and return a JSON object with the following structure:
{
  "description": "Detailed description of what's in the image",
  "tags": ["relevant", "tags", "for", "categorization"],
  "objects": ["specific", "objects", "visible"],
  "scene": "type of scene (indoor/outdoor/portrait/landscape/etc)",
  "mood": "emotional tone (happy/sad/excited/calm/energetic/peaceful/neutral)",
  "colors": ["dominant", "colors"],
  "confidence": 0.95,
  "categories": ["photography", "people", "nature", "etc"]
}

Be specific and detailed. Focus on elements that would help with memory recall and search.`
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${mimeType};base64,${base64Image}`,
                      detail: 'high'
                    }
                  }
                ]
              }
            ],
            max_tokens: 1000,
            temperature: 0.3
          });

          const content = response.choices[0]?.message?.content;
          if (!content) {
            throw new Error('No content in OpenAI Vision response');
          }

          // Parse JSON response
          let analysis: ImageAnalysis;
          try {
            // Extract JSON from response (in case there's extra text)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const jsonString = jsonMatch ? jsonMatch[0] : content;
            analysis = JSON.parse(jsonString);
          } catch (parseError) {
            logger.warn('Failed to parse OpenAI Vision JSON response, creating structured analysis', {
              content: content.substring(0, 200),
              parseError: parseError instanceof Error ? parseError.message : 'Unknown error'
            });
            
            // Fallback: create structured analysis from the text response
            analysis = this.createAnalysisFromText(content);
          }

          logger.info('Image analyzed using OpenAI Vision', {
            filename,
            imageSize: imageBuffer.length,
            objectsCount: analysis.objects?.length || 0,
            tagsCount: analysis.tags?.length || 0,
            confidence: analysis.confidence
          });

          return analysis;
        } catch (apiError) {
          logger.error('OpenAI Vision API error, falling back to mock analysis', { apiError });
          // Fall back to mock analysis if API fails
        }
      }

      // Fallback to mock analysis
      return this.mockImageAnalysis(imageBuffer, filename);

    } catch (error) {
      logger.error('Error analyzing image', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filename,
        imageSize: imageBuffer.length,
      });
      throw new BadRequestError(
        `Failed to analyze image: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.OPENAI_ERROR
      );
    }
  }

  /**
   * Create structured analysis from text response
   */
  private createAnalysisFromText(text: string): ImageAnalysis {
    // Basic text parsing to extract information
    const lowerText = text.toLowerCase();
    
    // Extract common objects and tags
    const commonObjects = ['person', 'people', 'face', 'building', 'car', 'tree', 'flower', 'food', 'animal', 'book', 'phone', 'computer'];
    const detectedObjects = commonObjects.filter(obj => lowerText.includes(obj));
    
    // Extract mood keywords
    const moodKeywords = {
      'happy': ['happy', 'joy', 'smile', 'cheerful', 'bright'],
      'sad': ['sad', 'melancholy', 'dark', 'gloomy'],
      'excited': ['excited', 'energetic', 'dynamic', 'vibrant'],
      'calm': ['calm', 'peaceful', 'serene', 'quiet'],
      'neutral': ['neutral', 'normal', 'standard']
    };
    
    let detectedMood: ImageAnalysis['mood'] = 'neutral';
    for (const [mood, keywords] of Object.entries(moodKeywords)) {
      if (keywords.some(keyword => lowerText.includes(keyword))) {
        detectedMood = mood as ImageAnalysis['mood'];
        break;
      }
    }

    // Extract colors
    const colorWords = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white', 'gray'];
    const detectedColors = colorWords.filter(color => lowerText.includes(color));

    return {
      description: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
      tags: this.extractTagsFromText(text),
      objects: detectedObjects,
      scene: this.extractSceneFromText(text),
      mood: detectedMood,
      colors: detectedColors.length > 0 ? detectedColors : ['unknown'],
      confidence: 0.7,
      categories: this.extractCategoriesFromText(text)
    };
  }

  /**
   * Extract tags from text description
   */
  private extractTagsFromText(text: string): string[] {
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    const commonTags = ['portrait', 'landscape', 'indoor', 'outdoor', 'nature', 'urban', 'food', 'travel', 'family', 'work'];
    return commonTags.filter((tag: string) => (words as string[]).includes(tag)).slice(0, 10);
  }

  /**
   * Extract scene type from text
   */
  private extractSceneFromText(text: string): string {
    const lowerText = text.toLowerCase();
    if (lowerText.includes('outdoor') || lowerText.includes('outside')) return 'outdoor';
    if (lowerText.includes('indoor') || lowerText.includes('inside')) return 'indoor';
    if (lowerText.includes('portrait') || lowerText.includes('face')) return 'portrait';
    if (lowerText.includes('landscape') || lowerText.includes('scenery')) return 'landscape';
    return 'unknown';
  }

  /**
   * Extract categories from text
   */
  private extractCategoriesFromText(text: string): string[] {
    const categories: string[] = [];
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('people') || lowerText.includes('person') || lowerText.includes('face')) {
      categories.push('people');
    }
    if (lowerText.includes('nature') || lowerText.includes('tree') || lowerText.includes('flower')) {
      categories.push('nature');
    }
    if (lowerText.includes('food') || lowerText.includes('eat') || lowerText.includes('meal')) {
      categories.push('food');
    }
    if (lowerText.includes('travel') || lowerText.includes('vacation') || lowerText.includes('trip')) {
      categories.push('travel');
    }
    if (lowerText.includes('work') || lowerText.includes('office') || lowerText.includes('business')) {
      categories.push('work');
    }
    
    return categories.length > 0 ? categories : ['general'];
  }

  /**
   * Generate image embeddings using CLIP (mock implementation)
   * In a full implementation, you'd use the actual CLIP model
   */
  async generateImageEmbedding(imageBuffer: Buffer): Promise<number[]> {
    try {
      // Mock CLIP embedding - in production, you'd use actual CLIP model
      // This creates a deterministic embedding based on image characteristics
      const hash = this.createImageHash(imageBuffer);
      const embedding = this.hashToEmbedding(hash);
      
      logger.info('Generated mock image embedding', {
        imageSize: imageBuffer.length,
        embeddingDimension: embedding.length,
        embeddingMagnitude: Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
      });
      
      return embedding;
    } catch (error) {
      logger.error('Failed to generate image embedding', {
        error: error instanceof Error ? error.message : 'Unknown error',
        imageSize: imageBuffer.length
      });
      throw new BadRequestError(
        `Failed to generate image embedding: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.OPENAI_ERROR
      );
    }
  }

  /**
   * Find similar images based on embeddings
   */
  async findSimilarImages(queryEmbedding: number[], imageEmbeddings: { id: string; embedding: number[] }[], threshold: number = 0.8): Promise<Array<{ id: string; similarity: number }>> {
    try {
      const similarities = imageEmbeddings.map(({ id, embedding }) => {
        const similarity = this.cosineSimilarity(queryEmbedding, embedding);
        return { id, similarity };
      });

      // Filter by threshold and sort by similarity
      const results = similarities
        .filter(item => item.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity);

      logger.info('Found similar images', {
        queryDimension: queryEmbedding.length,
        candidatesCount: imageEmbeddings.length,
        similarImagesCount: results.length,
        threshold
      });

      return results;
    } catch (error) {
      logger.error('Failed to find similar images', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Mock image analysis for fallback
   */
  private mockImageAnalysis(imageBuffer: Buffer, filename: string): ImageAnalysis {
    const size = imageBuffer.length;
    const hash = this.createImageHash(imageBuffer);
    
    // Deterministic mock analysis based on image characteristics
    const mockAnalyses = [
      {
        description: "A beautiful outdoor scene with natural lighting",
        tags: ["outdoor", "nature", "beautiful", "scenic"],
        objects: ["trees", "sky", "landscape"],
        scene: "outdoor",
        mood: "peaceful" as const,
        colors: ["green", "blue", "white"],
        confidence: 0.8,
        categories: ["nature", "landscape"]
      },
      {
        description: "Indoor portrait with good lighting and composition",
        tags: ["portrait", "indoor", "person", "professional"],
        objects: ["person", "face", "background"],
        scene: "portrait",
        mood: "happy" as const,
        colors: ["skin", "brown", "warm"],
        confidence: 0.85,
        categories: ["people", "portrait"]
      },
      {
        description: "Food photography showing a delicious meal",
        tags: ["food", "meal", "delicious", "photography"],
        objects: ["food", "plate", "table"],
        scene: "indoor",
        mood: "happy" as const,
        colors: ["brown", "red", "yellow"],
        confidence: 0.75,
        categories: ["food", "photography"]
      }
    ];

    // Select mock analysis based on hash
    const analysisIndex = hash % mockAnalyses.length;
    const baseAnalysis: ImageAnalysis = JSON.parse(JSON.stringify(mockAnalyses[analysisIndex])); // Deep copy

    // Add some variability based on image characteristics
    if (size > 500000) { // Large image
      baseAnalysis.tags.push("high-resolution");
      baseAnalysis.confidence += 0.05;
    }

    if (filename.toLowerCase().includes('selfie') || filename.toLowerCase().includes('portrait')) {
      baseAnalysis.scene = "portrait";
      baseAnalysis.objects = ["person", "face"];
      baseAnalysis.categories = ["people", "portrait"];
    }

    logger.info('Generated mock image analysis', {
      filename,
      imageSize: size,
      selectedAnalysis: analysisIndex,
      confidence: baseAnalysis.confidence
    });

    return baseAnalysis;
  }

  /**
   * Create a simple hash from image buffer
   */
  private createImageHash(buffer: Buffer): number {
    let hash = 0;
    for (let i = 0; i < Math.min(buffer.length, 1000); i++) {
      hash = ((hash << 5) - hash + (buffer[i] || 0)) & 0xffffffff;
    }
    return Math.abs(hash);
  }

  /**
   * Convert hash to embedding vector
   */
  private hashToEmbedding(hash: number, dimension: number = 512): number[] {
    const embedding = new Array(dimension);
    let seed = hash;
    
    for (let i = 0; i < dimension; i++) {
      // Simple linear congruential generator
      seed = (seed * 1664525 + 1013904223) % Math.pow(2, 32);
      embedding[i] = (seed / Math.pow(2, 32)) * 2 - 1; // Normalize to [-1, 1]
    }
    
    // Normalize the vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / magnitude);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += (a[i] || 0) * (b[i] || 0);
      normA += (a[i] || 0) * (a[i] || 0);
      normB += (b[i] || 0) * (b[i] || 0);
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Get MIME type from filename
   */
  private getMimeTypeFromFilename(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp'
    };
    return mimeTypes[ext || ''] || 'image/jpeg';
  }

  /**
   * Health check for image processing service
   */
  async healthCheck(): Promise<{ status: string; details?: any }> {
    try {
      if (this.openai && this.apiKey) {
        try {
          // Test API connectivity by making a simple request
          const response = await this.openai.models.list();
          
          return {
            status: 'healthy',
            details: {
              message: 'OpenAI API is responding correctly for image processing',
              apiConnected: true,
              modelsAvailable: response.data.length,
              visionModelAvailable: response.data.some(model => model.id.includes('vision')),
            },
          };
        } catch (apiError) {
          return {
            status: 'degraded',
            details: {
              message: 'OpenAI API not available, using mock image processing',
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
          message: 'Mock image processing service is working',
          apiConnected: false,
          apiKey: this.apiKey || 'mock',
        },
      };

    } catch (error) {
      logger.error('Image processing health check failed', {
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
}

let imageProcessingServiceInstance: ImageProcessingService | null = null;

export const getImageProcessingService = (): ImageProcessingService => {
  if (!imageProcessingServiceInstance) {
    imageProcessingServiceInstance = new ImageProcessingService();
  }
  return imageProcessingServiceInstance;
};
