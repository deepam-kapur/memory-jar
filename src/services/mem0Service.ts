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

interface Mem0APIResponse {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  score?: number;
}

interface Mem0SearchResponse {
  memories: Mem0APIResponse[];
}

interface Mem0HealthResponse {
  status: string;
  message?: string;
}

export class Mem0Service {
  private memoryStore: Map<string, any> = new Map(); // Fallback storage
  private memoryCounter = 0;
  private apiKey: string | undefined;
  private baseUrl: string;
  private maxRetries = 3;
  private retryDelay = 1000; // 1 second

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

      // Try real Mem0 API first
      if (this.apiKey) {
        try {
          const memoryId = await this.createMemoryWithAPI(memoryContent, metadata, userId, tags, importance);
          
          logger.info('Memory created in Mem0 API', {
            memoryId,
            userId,
            interactionId,
            memoryType,
            contentLength: memoryContent.length,
            hasMedia: mediaUrls.length > 0,
          });

          return memoryId;
        } catch (apiError) {
          logger.error('Mem0 API failed, falling back to local storage', {
            error: apiError instanceof Error ? apiError.message : 'Unknown error',
            userId,
            memoryType,
          });
          // Fall back to local storage
        }
      }

      // Fallback to local storage
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
   * Create memory using real Mem0 API with retry logic
   */
  private async createMemoryWithAPI(
    content: string, 
    metadata: Record<string, any>, 
    userId: string, 
    tags?: string[], 
    importance?: number
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Use dynamic import for fetch to avoid Node.js compatibility issues
        const { default: fetch } = await import('node-fetch');
        
        const response = await fetch(`${this.baseUrl}/memories`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'WhatsApp-Memory-Assistant/1.0.0',
          },
          body: JSON.stringify({
            content,
            metadata,
            userId,
            tags: tags || [],
            importance: importance || 1,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Mem0 API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json() as Mem0APIResponse;
        
        if (!result.id) {
          throw new Error('Mem0 API returned invalid response: missing memory ID');
        }

        return result.id;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (attempt < this.maxRetries) {
          logger.warn(`Mem0 API attempt ${attempt} failed, retrying in ${this.retryDelay}ms`, {
            error: lastError.message,
            attempt,
            maxRetries: this.maxRetries,
          });
          
          await this.delay(this.retryDelay * attempt); // Exponential backoff
        }
      }
    }

    throw lastError || new Error('Failed to create memory after all retries');
  }

  /**
   * Search memories using semantic search
   */
  async searchMemories(query: string, userId?: string, limit: number = 10): Promise<MemorySearchResult[]> {
    try {
      // Try real Mem0 API first
      if (this.apiKey) {
        try {
          const results = await this.searchMemoriesWithAPI(query, userId, limit);
          
          logger.info('Memories searched in Mem0 API', {
            query,
            resultsCount: results.length,
            userId,
            limit,
          });

          return results;
        } catch (apiError) {
          logger.error('Mem0 API search failed, falling back to local search', {
            error: apiError instanceof Error ? apiError.message : 'Unknown error',
            query,
            userId,
          });
          // Fall back to local search
        }
      }

      // Fallback to local search
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

      logger.info('Memories searched in local Mem0 storage', {
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
   * Search memories using real Mem0 API
   */
  private async searchMemoriesWithAPI(
    query: string, 
    userId?: string, 
    limit: number = 10
  ): Promise<MemorySearchResult[]> {
    const { default: fetch } = await import('node-fetch');
    
    const params = new URLSearchParams({
      query,
      limit: limit.toString(),
    });

    if (userId) {
      params.append('userId', userId);
    }

    const response = await fetch(`${this.baseUrl}/memories/search?${params}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsApp-Memory-Assistant/1.0.0',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mem0 API search error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json() as Mem0SearchResponse;
    
    if (!Array.isArray(result.memories)) {
      throw new Error('Mem0 API returned invalid response: missing memories array');
    }

    return result.memories.map((memory: Mem0APIResponse) => ({
      id: memory.id,
      content: memory.content,
      metadata: memory.metadata || {},
      score: memory.score || 0.5,
    }));
  }

  /**
   * Get a specific memory by ID
   */
  async getMemory(memoryId: string): Promise<MemorySearchResult | null> {
    try {
      // Try real Mem0 API first
      if (this.apiKey) {
        try {
          const { default: fetch } = await import('node-fetch');
          
          const response = await fetch(`${this.baseUrl}/memories/${memoryId}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              'User-Agent': 'WhatsApp-Memory-Assistant/1.0.0',
            },
          });

          if (response.status === 404) {
            return null;
          }

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Mem0 API error: ${response.status} ${response.statusText} - ${errorText}`);
          }

          const memory = await response.json() as Mem0APIResponse;
          
          return {
            id: memory.id,
            content: memory.content,
            metadata: memory.metadata || {},
            score: 1.0,
          };
        } catch (apiError) {
          logger.error('Mem0 API get failed, falling back to local storage', {
            error: apiError instanceof Error ? apiError.message : 'Unknown error',
            memoryId,
          });
          // Fall back to local storage
        }
      }

      // Fallback to local storage
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
      // Try real Mem0 API first
      if (this.apiKey) {
        try {
          const { default: fetch } = await import('node-fetch');
          
          const response = await fetch(`${this.baseUrl}/memories/${memoryId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              'User-Agent': 'WhatsApp-Memory-Assistant/1.0.0',
            },
          });

          if (response.status === 404) {
            logger.warn('Memory not found for deletion in Mem0 API', { memoryId });
            return;
          }

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Mem0 API error: ${response.status} ${response.statusText} - ${errorText}`);
          }

          logger.info('Memory deleted from Mem0 API', { memoryId });
          return;
        } catch (apiError) {
          logger.error('Mem0 API delete failed, falling back to local storage', {
            error: apiError instanceof Error ? apiError.message : 'Unknown error',
            memoryId,
          });
          // Fall back to local storage
        }
      }

      // Fallback to local storage
      const deleted = this.memoryStore.delete(memoryId);

      if (deleted) {
        logger.info('Memory deleted from local Mem0 storage', { memoryId });
      } else {
        logger.warn('Memory not found for deletion in local storage', { memoryId });
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
      // Test API connectivity if API key is available
      if (this.apiKey) {
        try {
          const { default: fetch } = await import('node-fetch');
          
          const response = await fetch(`${this.baseUrl}/health`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              'User-Agent': 'WhatsApp-Memory-Assistant/1.0.0',
            },
          });

          if (response.ok) {
            const healthData = await response.json() as Mem0HealthResponse;
            
            return {
              status: 'healthy',
              details: {
                message: 'Mem0 API is responding correctly',
                apiConnected: true,
                apiHealth: healthData,
                localMemories: this.memoryStore.size,
              },
            };
          } else {
            throw new Error(`Mem0 API health check failed: ${response.status}`);
          }
        } catch (apiError) {
          return {
            status: 'degraded',
            details: {
              message: 'Mem0 API not available, using local implementation',
              apiConnected: false,
              error: apiError instanceof Error ? apiError.message : 'Unknown error',
              localMemories: this.memoryStore.size,
            },
          };
        }
      }

      // Test local implementation
      const testMemory = await this.createMemory({
        content: {
          text: 'Health check test memory',
        },
        userId: 'health_check',
        memoryType: 'TEXT',
        tags: ['health_check'],
      });

      await this.deleteMemory(testMemory);

      return {
        status: 'healthy',
        details: {
          message: 'Local Mem0 service is working',
          apiConnected: false,
          localMemories: this.memoryStore.size,
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

  /**
   * Utility method for delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

let mem0ServiceInstance: Mem0Service | null = null;

export const getMem0Service = (): Mem0Service => {
  if (!mem0ServiceInstance) {
    mem0ServiceInstance = new Mem0Service();
  }
  return mem0ServiceInstance;
};
