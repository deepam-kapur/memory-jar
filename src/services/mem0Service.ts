import { Mem0 } from 'mem0ai';
import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export interface MemoryContent {
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
  metadata?: Record<string, any>;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface CreateMemoryOptions {
  content: MemoryContent;
  userId: string;
  interactionId?: string;
  memoryType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'MIXED';
  tags?: string[];
  importance?: number;
}

export class Mem0Service {
  private client: Mem0;

  constructor() {
    if (!env.MEM0_API_KEY) {
      throw new Error('MEM0_API_KEY is required for Mem0 integration');
    }

    this.client = new Mem0({
      apiKey: env.MEM0_API_KEY,
      baseUrl: env.MEM0_BASE_URL,
    });

    logger.info('Mem0 service initialized', {
      baseUrl: env.MEM0_BASE_URL,
    });
  }

  /**
   * Create a memory in Mem0
   */
  async createMemory(options: CreateMemoryOptions): Promise<string> {
    try {
      const { content, userId, interactionId, memoryType, tags, importance } = options;

      // Prepare memory content
      let memoryContent = '';
      let mediaUrls: string[] = [];

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

      // Create memory in Mem0
      const memory = await this.client.memory.create({
        content: memoryContent,
        metadata,
      });

      logger.info('Memory created in Mem0', {
        memoryId: memory.id,
        userId,
        interactionId,
        memoryType,
        contentLength: memoryContent.length,
        hasMedia: mediaUrls.length > 0,
      });

      return memory.id;
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
      // Build search filters
      const filters: Record<string, any> = {};
      if (userId) {
        filters.userId = userId;
      }

      // Search memories in Mem0
      const searchResults = await this.client.memory.search({
        query,
        filters,
        limit,
      });

      // Transform results to our format
      const results: MemorySearchResult[] = searchResults.memories.map((memory) => ({
        id: memory.id,
        content: memory.content,
        score: memory.score || 0,
        metadata: memory.metadata as Record<string, any>,
        createdAt: new Date(memory.createdAt || Date.now()),
      }));

      logger.info('Memory search completed', {
        query,
        resultsCount: results.length,
        userId,
        limit,
      });

      return results;
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
      const memory = await this.client.memory.get(memoryId);

      if (!memory) {
        return null;
      }

      return {
        id: memory.id,
        content: memory.content,
        score: 1.0, // Exact match
        metadata: memory.metadata as Record<string, any>,
        createdAt: new Date(memory.createdAt || Date.now()),
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
      await this.client.memory.delete(memoryId);
      logger.info('Memory deleted from Mem0', { memoryId });
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
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      // Try to create a test memory to verify connectivity
      const testMemory = await this.client.memory.create({
        content: 'Health check test memory',
        metadata: { healthCheck: true, timestamp: new Date().toISOString() },
      });

      // Clean up test memory
      await this.client.memory.delete(testMemory.id);

      return {
        status: 'healthy',
        message: 'Mem0 service is operational',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Mem0 service error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}

// Export singleton instance
let mem0ServiceInstance: Mem0Service | null = null;

export const getMem0Service = (): Mem0Service => {
  if (!mem0ServiceInstance) {
    mem0ServiceInstance = new Mem0Service();
  }
  return mem0ServiceInstance;
};
