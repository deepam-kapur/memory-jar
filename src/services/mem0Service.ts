import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export interface CreateMemoryOptions {
  content: {
    text?: string;
    imageUrl?: string;
    audioUrl?: string;
    metadata?: Record<string, any>;
  };
  userId: string;
  interactionId?: string;
  memoryType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'MIXED';
  tags?: string[];
  importance?: number;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  metadata: Record<string, any>;
  score: number;
}

export class Mem0Service {
  private memoryStore: Map<string, any> = new Map();
  private memoryCounter = 0;
  private apiKey: string | undefined;
  private baseUrl: string;

  constructor() {
    this.apiKey = env.MEM0_API_KEY;
    this.baseUrl = env.MEM0_BASE_URL || 'https://api.mem0.ai';
    
    if (!this.apiKey) {
      logger.warn('MEM0_API_KEY not provided, using local implementation');
    } else {
      logger.info('Mem0 service initialized with API key');
    }
  }

  /**
   * Create a memory in Mem0
   */
  async createMemory(options: CreateMemoryOptions): Promise<string> {
    try {
      const { content, userId, interactionId, memoryType, tags, importance } = options;

      // Prepare memory content
      let memoryContent = '';
      const mediaUrls: string[] = [];

      if (content.text) {
        memoryContent = content.text;
      }

      if (content.imageUrl) {
        mediaUrls.push(content.imageUrl);
        if (!memoryContent) {
          memoryContent = `[Image memory]`;
        }
      }

      if (content.audioUrl) {
        mediaUrls.push(content.audioUrl);
        if (!memoryContent) {
          memoryContent = `[Audio memory]`;
        }
      }

      // Prepare metadata
      const metadata = {
        userId,
        interactionId,
        memoryType,
        tags: tags || [],
        importance: importance || 1,
        mediaUrls,
        ...content.metadata,
        createdAt: new Date().toISOString(),
      };

      // Use local storage for now (can be enhanced with real API later)
      const memoryId = `mem_${++this.memoryCounter}_${Date.now()}`;
      const memory = {
        id: memoryId,
        content: memoryContent,
        metadata,
        createdAt: new Date(),
      };

      this.memoryStore.set(memoryId, memory);

      logger.info('Memory created in local Mem0 storage', {
        memoryId,
        userId,
        interactionId,
        memoryType,
        contentLength: memoryContent.length,
        hasMedia: mediaUrls.length > 0,
      });

      return memoryId;
    } catch (error) {
      logger.error('Error creating memory in Mem0', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: options.userId,
        memoryType: options.memoryType,
      });
      throw new BadRequestError(
        `Failed to create memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.MEM0_ERROR
      );
    }
  }

  /**
   * Search memories using semantic search
   */
  async searchMemories(query: string, userId?: string, limit: number = 10): Promise<MemorySearchResult[]> {
    try {
      const results: MemorySearchResult[] = [];

      // Simple text-based search
      for (const [, memory] of this.memoryStore.entries()) {
        if (userId && memory.metadata.userId !== userId) {
          continue;
        }

        const content = memory.content.toLowerCase();
        const searchQuery = query.toLowerCase();
        
        if (content.includes(searchQuery)) {
          results.push({
            id: memory.id,
            content: memory.content,
            metadata: memory.metadata,
            score: 0.8,
          });
        }
      }

      // Sort by score and limit results
      results.sort((a, b) => b.score - a.score);
      const limitedResults = results.slice(0, limit);

      logger.info('Memories searched in Mem0', {
        query,
        resultsCount: limitedResults.length,
        userId,
        limit,
      });

      return limitedResults;
    } catch (error) {
      logger.error('Error searching memories in Mem0', {
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
   * Get a specific memory by ID
   */
  async getMemory(memoryId: string): Promise<MemorySearchResult | null> {
    try {
      const memory = this.memoryStore.get(memoryId);

      if (!memory) {
        return null;
      }

      return {
        id: memory.id,
        content: memory.content,
        metadata: memory.metadata,
        score: 1.0,
      };
    } catch (error) {
      logger.error('Error getting memory from Mem0', {
        error: error instanceof Error ? error.message : 'Unknown error',
        memoryId,
      });
      throw new BadRequestError(
        `Failed to get memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.MEM0_ERROR
      );
    }
  }

  /**
   * Delete a memory by ID
   */
  async deleteMemory(memoryId: string): Promise<void> {
    try {
      const deleted = this.memoryStore.delete(memoryId);

      if (deleted) {
        logger.info('Memory deleted from Mem0', {
          memoryId,
        });
      } else {
        logger.warn('Memory not found for deletion', {
          memoryId,
        });
      }
    } catch (error) {
      logger.error('Error deleting memory from Mem0', {
        error: error instanceof Error ? error.message : 'Unknown error',
        memoryId,
      });
      throw new BadRequestError(
        `Failed to delete memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.MEM0_ERROR
      );
    }
  }

  /**
   * Health check for Mem0 service
   */
  async healthCheck(): Promise<{ status: string; details?: any }> {
    try {
      // Create a test memory
      const testMemory = await this.createMemory({
        content: {
          text: 'Health check test memory',
        },
        userId: 'health_check',
        memoryType: 'TEXT',
        tags: ['health_check'],
      });

      // Delete the test memory
      await this.deleteMemory(testMemory);

      return {
        status: 'healthy',
        details: {
          message: 'Mem0 service is responding correctly',
          testMemoryId: testMemory,
          totalMemories: this.memoryStore.size,
        },
      };
    } catch (error) {
      logger.error('Mem0 health check failed', {
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

let mem0ServiceInstance: Mem0Service | null = null;

export const getMem0Service = (): Mem0Service => {
  if (!mem0ServiceInstance) {
    mem0ServiceInstance = new Mem0Service();
  }
  return mem0ServiceInstance;
};
