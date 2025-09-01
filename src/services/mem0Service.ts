import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';
import { Memory } from 'mem0ai/oss';
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
  private memory: any = null;
  private memoryStore: Map<string, any> = new Map(); // Fallback storage
  private memoryCounter = 0;
  private isInitialized = false;
  private usePackage = false;

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Try to initialize mem0ai package
      await this.initializePackage();
    } catch (error) {
      logger.warn('Failed to initialize mem0ai package, using fallback storage', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.initializeFallback();
    }
  }

  private async initializePackage(): Promise<void> {
    try {
      console.log('Initializing mem0ai package');
      console.log(env.OPENAI_API_KEY)
      
      this.memory = new Memory({
        version: 'v1.1',
        embedder: {
          provider: 'openai',
          config: {
            apiKey: env.OPENAI_API_KEY || '',
            model: 'text-embedding-3-small',
          },
        },
        vectorStore: {
          provider: 'memory', // Uses in-memory storage
          config: {
            collectionName: 'memories',
            dimension: 1536,
          },
        },
        llm: {
          provider: 'openai',
          config: {
            apiKey: env.OPENAI_API_KEY || '',
            model: 'gpt-5-mini',
          },
        },
        historyStore: {
          provider: 'sqlite',
          config: {},
        },
        disableHistory: false,
        customPrompt: "You are a helpful memory assistant that stores and retrieves user memories efficiently.",
      });

      // Test the memory instance
      await this.memory.search('health_check_test', { userId: 'system_health_check' });
      
      this.usePackage = true;
      this.isInitialized = true;
      
      logger.info('Mem0 service initialized with npm package', {
        service: 'memory-jar',
        environment: env.NODE_ENV,
      });
    } catch (error) {
      throw new Error(`Failed to initialize mem0ai package: ${error}`);
    }
  }

  private async initializeFallback(): Promise<void> {
    // Initialize simple in-memory storage
    this.memoryStore.clear();
    this.memoryCounter = 0;
    this.usePackage = false;
    this.isInitialized = true;
    
    logger.info('Mem0 service initialized with fallback local storage', {
      service: 'memory-jar',
      environment: env.NODE_ENV,
    });
  }

  async createMemory(options: CreateMemoryOptions): Promise<string> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

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
        timestamp: new Date().toISOString(),
        ...content.metadata,
      };

      let memoryId: string;

      if (this.usePackage && this.memory) {
        // Use mem0ai package
        try {
          const messages = [
            {
              role: "user" as const,
              content: memoryContent
            }
          ];

          const result = await this.memory.add(messages, { 
            userId, 
            metadata 
          });

          memoryId = Array.isArray(result) && result.length > 0 ? result[0].id : 
                     (result as any).id || 
                     `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          logger.info('Memory created using mem0ai package', {
            memoryId,
            userId,
            memoryType,
            contentLength: memoryContent.length,
            hasMedia: mediaUrls.length > 0,
          });
        } catch (error) {
          logger.warn('mem0ai package failed, falling back to local storage', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // Fall back to local storage
          memoryId = await this.createMemoryFallback(memoryContent, metadata);
        }
      } else {
        // Use fallback storage
        memoryId = await this.createMemoryFallback(memoryContent, metadata);
      }

      return memoryId;
    } catch (error) {
      logger.error('Failed to create memory', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: options.userId,
        memoryType: options.memoryType,
      });

      throw new BadRequestError(
        'Failed to create memory',
        ErrorCodes.MEMORY_CREATION_FAILED
      );
    }
  }

  private async createMemoryFallback(content: string, metadata: any): Promise<string> {
    this.memoryCounter++;
    const memoryId = `mem_${this.memoryCounter}_${Date.now()}`;
    
    this.memoryStore.set(memoryId, {
      id: memoryId,
      content,
      metadata,
      createdAt: new Date().toISOString(),
    });

    logger.info('Memory created in local fallback storage', {
      memoryId,
      userId: metadata.userId,
      memoryType: metadata.memoryType,
      contentLength: content.length,
      hasMedia: metadata.mediaUrls?.length > 0,
    });

    return memoryId;
  }

  async searchMemories(query: string, userId?: string, limit: number = 10): Promise<MemorySearchResult[]> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.usePackage && this.memory) {
        try {
          const searchOptions: any = {};
          if (userId) {
            searchOptions.userId = userId;
          }

          const results = await this.memory.search(query, searchOptions);
          const resultsArray = Array.isArray(results) ? results : [results];
          
          const memoryResults: MemorySearchResult[] = resultsArray.slice(0, limit).map((memory: any) => ({
            id: memory.id || memory.memory_id || 'unknown',
            content: memory.content || memory.memory || '',
            metadata: memory.metadata || {},
            score: memory.score || 0,
          }));

          logger.info('Memories searched using mem0ai package', {
            query,
            resultsCount: memoryResults.length,
            userId,
            limit,
          });

          return memoryResults;
        } catch (error) {
          logger.warn('mem0ai search failed, falling back to local search', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // Fall back to local search
          return this.searchMemoriesFallback(query, userId, limit);
        }
      } else {
        return this.searchMemoriesFallback(query, userId, limit);
      }
    } catch (error) {
      logger.error('Failed to search memories', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query,
        userId,
      });

      return [];
    }
  }

  private searchMemoriesFallback(query: string, userId?: string, limit: number = 10): MemorySearchResult[] {
    const results: MemorySearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const [id, memory] of this.memoryStore) {
      // Filter by userId if provided
      if (userId && memory.metadata.userId !== userId) {
        continue;
      }

      // Simple text matching
      const content = memory.content.toLowerCase();
      if (content.includes(queryLower)) {
        // Calculate simple score based on query position
        const firstIndex = content.indexOf(queryLower);
        const score = firstIndex === 0 ? 1.0 : 1.0 - (firstIndex / content.length);

        results.push({
          id: memory.id,
          content: memory.content,
          metadata: memory.metadata,
          score,
        });
      }
    }

    // Sort by score and limit
    const sortedResults = results.sort((a, b) => b.score - a.score).slice(0, limit);

    logger.info('Memories searched using fallback storage', {
      query,
      resultsCount: sortedResults.length,
      userId,
      limit,
    });

    return sortedResults;
  }

  async getMemories(userId: string, limit: number = 50): Promise<MemorySearchResult[]> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.usePackage && this.memory) {
        try {
          const memories = await this.memory.getAll({ userId });
          const memoriesArray = Array.isArray(memories) ? memories : [memories];
          
          const memoryResults: MemorySearchResult[] = memoriesArray.slice(0, limit).map((memory: any) => ({
            id: memory.id || memory.memory_id || 'unknown',
            content: memory.content || memory.memory || '',
            metadata: memory.metadata || {},
            score: 1.0,
          }));

          logger.info('Retrieved memories using mem0ai package', {
            userId,
            count: memoryResults.length,
            limit,
          });

          return memoryResults;
        } catch (error) {
          logger.warn('mem0ai getAll failed, falling back to local storage', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return this.getMemoriesFallback(userId, limit);
        }
      } else {
        return this.getMemoriesFallback(userId, limit);
      }
    } catch (error) {
      logger.error('Failed to get memories', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
      });

      return [];
    }
  }

  private getMemoriesFallback(userId: string, limit: number = 50): MemorySearchResult[] {
    const results: MemorySearchResult[] = [];

    for (const [id, memory] of this.memoryStore) {
      if (memory.metadata.userId === userId) {
        results.push({
          id: memory.id,
          content: memory.content,
          metadata: memory.metadata,
          score: 1.0,
        });
      }
    }

    const limitedResults = results.slice(0, limit);

    logger.info('Retrieved memories using fallback storage', {
      userId,
      count: limitedResults.length,
      limit,
    });

    return limitedResults;
  }

  async updateMemory(memoryId: string, content: string, metadata?: Record<string, any>): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.usePackage && this.memory) {
        try {
          await this.memory.update(memoryId, content);
          logger.info('Memory updated using mem0ai package', { memoryId });
          return;
        } catch (error) {
          logger.warn('mem0ai update failed, falling back to local storage', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Fallback update
      const memory = this.memoryStore.get(memoryId);
      if (memory) {
        memory.content = content;
        if (metadata) {
          memory.metadata = { ...memory.metadata, ...metadata };
        }
        memory.updatedAt = new Date().toISOString();
        this.memoryStore.set(memoryId, memory);
        
        logger.info('Memory updated using fallback storage', { memoryId });
      } else {
        throw new Error('Memory not found');
      }
    } catch (error) {
      logger.error('Failed to update memory', {
        error: error instanceof Error ? error.message : 'Unknown error',
        memoryId,
      });

      throw new BadRequestError(
        'Failed to update memory',
        ErrorCodes.MEMORY_UPDATE_FAILED
      );
    }
  }

  async deleteMemory(memoryId: string): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.usePackage && this.memory) {
        try {
          await this.memory.delete(memoryId);
          logger.info('Memory deleted using mem0ai package', { memoryId });
          return;
        } catch (error) {
          logger.warn('mem0ai delete failed, falling back to local storage', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Fallback delete
      const deleted = this.memoryStore.delete(memoryId);
      if (deleted) {
        logger.info('Memory deleted using fallback storage', { memoryId });
      } else {
        throw new Error('Memory not found');
      }
    } catch (error) {
      logger.error('Failed to delete memory', {
        error: error instanceof Error ? error.message : 'Unknown error',
        memoryId,
      });

      throw new BadRequestError(
        'Failed to delete memory',
        ErrorCodes.MEMORY_DELETION_FAILED
      );
    }
  }

  async deleteAllMemories(userId: string): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.usePackage && this.memory) {
        try {
          await this.memory.deleteAll({ userId });
          logger.info('All memories deleted using mem0ai package', { userId });
          return;
        } catch (error) {
          logger.warn('mem0ai deleteAll failed, falling back to local storage', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Fallback delete all
      let deletedCount = 0;
      for (const [id, memory] of this.memoryStore) {
        if (memory.metadata.userId === userId) {
          this.memoryStore.delete(id);
          deletedCount++;
        }
      }

      logger.info('All memories deleted using fallback storage', { 
        userId, 
        deletedCount 
      });
    } catch (error) {
      logger.error('Failed to delete all memories', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
      });

      throw new BadRequestError(
        'Failed to delete all memories',
        ErrorCodes.MEMORY_DELETION_FAILED
      );
    }
  }

  async getMemoryHistory(memoryId: string): Promise<any[]> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.usePackage && this.memory) {
        try {
          const history = await this.memory.history(memoryId);
          logger.info('Retrieved memory history using mem0ai package', {
            memoryId,
            historyCount: history.length,
          });
          return history;
        } catch (error) {
          logger.warn('mem0ai history failed, no fallback available', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // No fallback for history
      return [];
    } catch (error) {
      logger.error('Failed to get memory history', {
        error: error instanceof Error ? error.message : 'Unknown error',
        memoryId,
      });

      return [];
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.usePackage && this.memory) {
        try {
          await this.memory.search('health_check', { userId: 'system_health_check' });
          return true;
        } catch (error) {
          logger.warn('mem0ai health check failed, but fallback is available', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Fallback is always healthy if initialized
      return this.isInitialized;
    } catch (error) {
      logger.error('Mem0 health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  async resetMemories(): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.usePackage && this.memory) {
        try {
          await this.memory.reset();
          logger.info('All memories reset using mem0ai package');
          return;
        } catch (error) {
          logger.warn('mem0ai reset failed, falling back to local storage', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Fallback reset
      this.memoryStore.clear();
      this.memoryCounter = 0;
      logger.info('All memories reset using fallback storage');
    } catch (error) {
      logger.error('Failed to reset memories', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new BadRequestError(
        'Failed to reset memories',
        ErrorCodes.MEMORY_DELETION_FAILED
      );
    }
  }

  async getMemoryStats(userId?: string): Promise<{ totalMemories: number; userMemories?: number }> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const stats: { totalMemories: number; userMemories?: number } = {
        totalMemories: 0,
      };

      if (this.usePackage && this.memory) {
        try {
          if (userId) {
            const userMemories = await this.getMemories(userId, 1000);
            stats.userMemories = userMemories.length;
          }
          stats.totalMemories = stats.userMemories || 0;
          return stats;
        } catch (error) {
          logger.warn('mem0ai stats failed, falling back to local count', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Fallback stats
      stats.totalMemories = this.memoryStore.size;
      if (userId) {
        stats.userMemories = Array.from(this.memoryStore.values())
          .filter(memory => memory.metadata.userId === userId).length;
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get memory statistics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
      });

      return { totalMemories: 0, userMemories: 0 };
    }
  }

  // Get current implementation info
  getImplementationInfo(): { usePackage: boolean; isInitialized: boolean; fallbackSize: number } {
    return {
      usePackage: this.usePackage,
      isInitialized: this.isInitialized,
      fallbackSize: this.memoryStore.size,
    };
  }
}

// Export singleton instance
export const mem0Service = new Mem0Service();

// Legacy function for backwards compatibility
export function getMem0Service(): Mem0Service {
  return mem0Service;
}