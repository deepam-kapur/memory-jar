import { MemoryClient } from 'mem0ai';
import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export interface CreateMemoryOptions {
  content: {
    text?: string;
    imageUrl?: string;
    audioUrl?: string;
    metadata?: Record<string, unknown>;
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
  metadata: Record<string, unknown>;
  score: number;
}

export class Mem0Service {
  private client: MemoryClient | null = null;
  private isConnected: boolean = false;

  constructor() {
    if (env.MEM0_API_KEY) {
      try {
        this.client = new MemoryClient({
          apiKey: env.MEM0_API_KEY
        });
        this.isConnected = true;
        logger.info('Mem0 client initialized successfully', {
          hasApiKey: !!env.MEM0_API_KEY,
          baseUrl: env.MEM0_BASE_URL || 'https://api.mem0.ai'
        });
      } catch (error) {
        logger.error('Failed to initialize Mem0 client', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        this.isConnected = false;
      }
    } else {
      logger.warn('MEM0_API_KEY not provided, Mem0 functionality will be limited');
      this.isConnected = false;
    }
  }

  /**
   * Create a memory in Mem0 using semantic storage
   */
  async createMemory(options: CreateMemoryOptions): Promise<string> {
    try {
      const { content, userId, interactionId, memoryType, tags = [], importance = 5 } = options;

      if (!this.isConnected || !this.client) {
        logger.warn('Mem0 not connected, cannot create semantic memory');
        throw new BadRequestError('Mem0 service not available', ErrorCodes.MEM0_ERROR);
      }

      // Format memory content for semantic storage with enhanced context
      let memoryText = '';
      const metadata: Record<string, unknown> = {
        userId,
        interactionId,
        memoryType,
        importance,
        tags,
        timestamp: new Date().toISOString(),
        date: new Date().toISOString().split('T')[0], // For day-based queries
        ...content.metadata,
      };

      if (content.text) {
        memoryText = content.text;
        
        // Enhance memory with semantic context for better Mem0 understanding
        memoryText = this.enhanceMemoryContext(content.text, tags);
      }

      if (content.imageUrl) {
        metadata['imageUrl'] = content.imageUrl;
        memoryText += `\n[Visual memory - image contains: ${content.metadata?.['imageDescription'] || 'visual content'}]`;
      }

      if (content.audioUrl) {
        metadata['audioUrl'] = content.audioUrl;
        memoryText += `\n[Audio memory - contains: ${content.metadata?.['audioTranscription'] || 'spoken content'}]`;
      }

      // Create memory in Mem0 with semantic embeddings
      const messages = [
        {
          role: "user" as const,
          content: memoryText
        }
      ];

      const response = await this.client.add(messages, {
        user_id: userId,
        metadata: metadata
      });

      const memoryId = Array.isArray(response) && response.length > 0 && response[0] ? 
        response[0].id || `mem_${Date.now()}` : 
        `mem_${Date.now()}`;

      logger.info('Memory created in Mem0 semantic storage', {
        memoryId,
        userId,
        interactionId,
        memoryType,
        contentLength: memoryText.length,
        hasMetadata: Object.keys(metadata).length > 0,
        tags: tags.length
      });

      return memoryId;
    } catch (error) {
      logger.error('Error creating memory in Mem0', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: options.userId,
        memoryType: options.memoryType,
      });
      throw new BadRequestError(
        `Failed to create semantic memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.MEM0_ERROR
      );
    }
  }

  /**
   * Search memories using Mem0's semantic search capabilities
   */
  async searchMemories(query: string, userId?: string, limit: number = 10): Promise<MemorySearchResult[]> {
    try {
      if (!this.isConnected || !this.client) {
        logger.warn('Mem0 not connected, cannot perform semantic search');
        return [];
      }

      // Use Mem0's semantic search
      const response = await this.client.search(query, {
        user_id: userId,
        limit
      });

      const results: MemorySearchResult[] = Array.isArray(response) ? 
        response.map((result: any) => ({
          id: (result['id'] as string) || `result_${Date.now()}`,
          content: (result['memory'] as string) || (result['content'] as string) || '',
          metadata: (result['metadata'] as Record<string, unknown>) || {},
          score: (result['score'] as number) || 0.8
        })) : [];

      logger.info('Semantic search completed', {
        query,
        userId,
        resultsCount: results.length,
        limit,
        hasResults: results.length > 0
      });

      return results;
    } catch (error) {
      logger.error('Error searching memories in Mem0', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query,
        userId,
      });
      return [];
    }
  }

  /**
   * Get all memories for a user using Mem0
   */
  async getAllMemories(userId: string, limit: number = 100): Promise<MemorySearchResult[]> {
    try {
      if (!this.isConnected || !this.client) {
        logger.warn('Mem0 not connected, cannot retrieve memories');
        return [];
      }

      // Get all memories for user
      const response = await this.client.getAll({
        user_id: userId,
        limit
      });

      const memories: MemorySearchResult[] = Array.isArray(response) ? 
        response.map((memory: any) => ({
          id: (memory['id'] as string) || `mem_${Date.now()}`,
          content: (memory['memory'] as string) || (memory['content'] as string) || '',
          metadata: (memory['metadata'] as Record<string, unknown>) || {},
          score: 1.0 // Full score for direct retrieval
        })) : [];

      logger.info('Retrieved all memories for user', {
        userId,
        memoriesCount: memories.length,
        limit
      });

      return memories;
    } catch (error) {
      logger.error('Error retrieving all memories from Mem0', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
      });
      return [];
    }
  }

  /**
   * Delete a memory from Mem0
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    try {
      if (!this.isConnected || !this.client) {
        logger.warn('Mem0 not connected, cannot delete memory');
        return false;
      }

      await this.client.delete(memoryId);

      logger.info('Memory deleted from Mem0', {
        memoryId
      });

      return true;
    } catch (error) {
      logger.error('Error deleting memory from Mem0', {
        error: error instanceof Error ? error.message : 'Unknown error',
        memoryId,
      });
      return false;
    }
  }

  /**
   * Update memory metadata in Mem0
   */
  async updateMemory(memoryId: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    try {
      if (!this.isConnected || !this.client) {
        logger.warn('Mem0 not connected, cannot update memory');
        return false;
      }

      await this.client.update(memoryId, content);

      logger.info('Memory updated in Mem0', {
        memoryId,
        hasMetadata: !!metadata
      });

      return true;
    } catch (error) {
      logger.error('Error updating memory in Mem0', {
        error: error instanceof Error ? error.message : 'Unknown error',
        memoryId,
      });
      return false;
    }
  }

  /**
   * Get memory context for a user - useful for conversational AI
   */
  async getMemoryContext(userId: string, query?: string): Promise<string[]> {
    try {
      if (!this.isConnected || !this.client) {
        return [];
      }

      let memories: MemorySearchResult[] = [];

      if (query) {
        // Search for relevant memories
        memories = await this.searchMemories(query, userId, 5);
      } else {
        // Get recent memories
        memories = await this.getAllMemories(userId, 10);
      }

      // Return memory contents for context
      return memories.map(memory => memory.content);
    } catch (error) {
      logger.error('Error getting memory context', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        query
      });
      return [];
    }
  }

  /**
   * Check if Mem0 is properly connected
   */
  isMemoryServiceConnected(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Enhance memory content for better semantic understanding by Mem0
   * This is crucial for showcasing Mem0's capabilities for facts, recalls, and personal knowledge
   */
  private enhanceMemoryContext(text: string, tags: string[] = []): string {
    let enhancedText = text;
    const now = new Date();
    const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
    const date = now.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    // Add temporal context for better "when did I say" queries
    enhancedText += `\n[Recorded on ${dayName}, ${date}]`;

    // Detect and enhance different types of personal knowledge for Mem0
    if (this.isBirthdayMention(text)) {
      enhancedText += `\n[PERSONAL FACT: Birthday information - important for future recall]`;
    }

    if (this.isTravelPlan(text)) {
      enhancedText += `\n[PERSONAL PLAN: Travel/trip planning - future event to remember]`;
    }

    if (this.isTaskOrTodo(text)) {
      enhancedText += `\n[PERSONAL TASK: To-do item or responsibility - action required]`;
    }

    if (this.isMeetingNote(text)) {
      enhancedText += `\n[MEETING MEMORY: Professional discussion or appointment - important for work context]`;
    }

    if (this.isPreferenceOrOpinion(text)) {
      enhancedText += `\n[PERSONAL PREFERENCE: Opinion or preference expressed - valuable for future recommendations]`;
    }

    if (this.isRelationshipInfo(text)) {
      enhancedText += `\n[RELATIONSHIP INFO: Information about people or social connections]`;
    }

    // Add mood and emotional context if detected in tags
    const emotionalTags = tags.filter(tag => 
      ['happy', 'sad', 'excited', 'stressed', 'angry', 'calm', 'worried', 'confident', 'nervous'].includes(tag.toLowerCase())
    );
    
    if (emotionalTags.length > 0) {
      enhancedText += `\n[EMOTIONAL STATE: Feeling ${emotionalTags.join(', ')} - important for mood-based recall]`;
    }

    return enhancedText;
  }

  // Helper methods to detect different types of personal knowledge for Mem0
  private isBirthdayMention(text: string): boolean {
    const birthdayKeywords = ['birthday', 'born on', 'turns', 'age', 'celebrating', 'party for'];
    return birthdayKeywords.some(keyword => text.toLowerCase().includes(keyword));
  }

  private isTravelPlan(text: string): boolean {
    const travelKeywords = ['trip to', 'travel', 'vacation', 'flight', 'hotel', 'visit', 'going to', 'plane', 'airport'];
    return travelKeywords.some(keyword => text.toLowerCase().includes(keyword));
  }

  private isTaskOrTodo(text: string): boolean {
    const taskKeywords = ['need to', 'have to', 'should', 'must', 'remind me', 'todo', 'task', 'complete', 'finish'];
    return taskKeywords.some(keyword => text.toLowerCase().includes(keyword));
  }

  private isMeetingNote(text: string): boolean {
    const meetingKeywords = ['meeting', 'call', 'conference', 'discussion', 'agenda', 'notes from', 'talked about'];
    return meetingKeywords.some(keyword => text.toLowerCase().includes(keyword));
  }

  private isPreferenceOrOpinion(text: string): boolean {
    const preferenceKeywords = ['i like', 'i love', 'i hate', 'i prefer', 'favorite', 'best', 'worst', 'opinion'];
    return preferenceKeywords.some(keyword => text.toLowerCase().includes(keyword));
  }

  private isRelationshipInfo(text: string): boolean {
    const relationshipKeywords = ['friend', 'family', 'colleague', 'boss', 'partner', 'spouse', 'child', 'parent'];
    return relationshipKeywords.some(keyword => text.toLowerCase().includes(keyword));
  }

  /**
   * Enhanced search with better query understanding for Mem0 demo
   */
  async searchMemoriesWithContext(query: string, userId: string, timeframe?: string): Promise<MemorySearchResult[]> {
    try {
      if (!this.isConnected || !this.client) {
        logger.warn('Mem0 not connected, cannot perform semantic search');
        return [];
      }

      // Enhance query for better Mem0 semantic understanding
      let enhancedQuery = query;
      
      // Add temporal context for time-based queries
      if (timeframe) {
        enhancedQuery += ` [timeframe: ${timeframe}]`;
      }

      // Detect intent and enhance query accordingly
      if (query.toLowerCase().includes('birthday')) {
        enhancedQuery += ' [searching for: personal facts, birthday information]';
      }
      
      if (query.toLowerCase().includes('travel') || query.toLowerCase().includes('trip')) {
        enhancedQuery += ' [searching for: travel plans, vacation information]';
      }
      
      if (query.toLowerCase().includes('task') || query.toLowerCase().includes('todo')) {
        enhancedQuery += ' [searching for: tasks, responsibilities, things to do]';
      }
      
      if (query.toLowerCase().includes('meeting') || query.toLowerCase().includes('work')) {
        enhancedQuery += ' [searching for: professional discussions, work-related information]';
      }

      // Use enhanced query with Mem0
      const response = await this.client.search(enhancedQuery, {
        user_id: userId,
        limit: 10
      });

      const results: MemorySearchResult[] = Array.isArray(response) ? 
        response.map((result: any) => ({
          id: (result['id'] as string) || `result_${Date.now()}`,
          content: (result['memory'] as string) || (result['content'] as string) || '',
          metadata: (result['metadata'] as Record<string, unknown>) || {},
          score: (result['score'] as number) || 0.8
        })) : [];

      logger.info('Enhanced Mem0 semantic search completed', {
        originalQuery: query,
        enhancedQuery,
        userId,
        resultsCount: results.length,
        timeframe,
        hasResults: results.length > 0
      });

      return results;
    } catch (error) {
      logger.error('Error in enhanced Mem0 search', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query,
        userId,
        timeframe
      });
      return [];
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