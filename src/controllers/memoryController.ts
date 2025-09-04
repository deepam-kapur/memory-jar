import { Request, Response } from 'express';
import { getDatabase } from '../services/database';
import { getMem0Service } from '../services/mem0Service';
import { NotFoundError, BadRequestError, ErrorCodes } from '../utils/errors';
import logger from '../config/logger';

export class MemoryController {
  /**
   * Create a new memory (multimodal)
   * POST /memories
   */
  static async createMemory(req: Request, res: Response) {
    try {
      const { userId, interactionId, content, memoryType, tags, importance, mediaUrls, transcript } = req.body;
      const db = getDatabase();

      // Validate user exists
      const user = await db.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundError('User not found', ErrorCodes.RESOURCE_NOT_FOUND);
      }

      // Validate interaction belongs to user if provided
      if (interactionId) {
        const interaction = await db.interaction.findUnique({
          where: { id: interactionId },
        });

        if (!interaction) {
          throw new NotFoundError('Interaction not found', ErrorCodes.RESOURCE_NOT_FOUND);
        }

        if (interaction.userId !== userId) {
          throw new BadRequestError('Interaction does not belong to user', ErrorCodes.INVALID_INPUT);
        }
      }

      // Create memory in Mem0 first
      const mem0Service = getMem0Service();
      const mem0Id = await mem0Service.createMemory({
        content: {
          text: content,
          metadata: {
            mediaUrls: mediaUrls || [],
            transcript,
          },
        },
        userId,
        interactionId,
        memoryType,
        tags,
        importance,
      });

      const memory = await db.memory.create({
        data: {
          userId,
          interactionId,
          content,
          memoryType,
          tags: tags || [],
          importance: importance || 1,
          mem0Id,
        },
        include: {
          user: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
          interaction: {
            select: {
              id: true,
              messageType: true,
              content: true,
            },
          },
        },
      });

      // Update interaction status if provided
      if (interactionId) {
        await db.interaction.update({
          where: { id: interactionId },
          data: { status: 'PROCESSED' },
        });
      }

      logger.info('Memory created', {
        memoryId: memory.id,
        userId,
        memoryType,
        mem0Id,
        requestId: req.id,
      });

      res.status(201).json({ data: memory });

    } catch (error) {
      logger.error('Error creating memory', { error });
      throw error;
    }
  }

  /**
   * Search memories using ONLY Mem0 for semantic search - showcases full Mem0 capabilities
   * GET /memories?query=<text>
   */
  static async searchMemories(req: Request, res: Response) {
    try {
      const { query, limit = 20, userId } = req.query;
      
      if (!query) {
        return res.status(400).json({
          success: false,
          message: 'Query parameter is required for Mem0 semantic search',
          error: {
            code: 'MISSING_QUERY',
            details: 'Provide a natural language query to search your memories'
          }
        });
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required for Mem0 search',
          error: {
            code: 'MISSING_USER_ID',
            details: 'User context is required for semantic memory retrieval'
          }
        });
      }

      const mem0Service = getMem0Service();
      
      // Use ONLY Mem0 for semantic search - this showcases Mem0's core capabilities
      logger.info('Using Mem0 semantic search for query', {
        query: query as string,
        userId: userId as string,
        limit: Number(limit)
      });

      const mem0Results = await mem0Service.searchMemories(
        query as string,
        userId as string,
        Number(limit)
      );

      if (mem0Results.length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No memories found for this query',
          data: {
            memories: [],
            total: 0,
            query: query as string,
            searchType: 'semantic_mem0',
            suggestion: 'Try rephrasing your query or ask about something you\'ve shared before'
          }
        });
      }

      // Format Mem0 results for API response
      const formattedMemories = mem0Results.map(result => ({
        id: result.id,
        content: result.content,
        metadata: result.metadata,
        score: result.score,
        relevance: result.score > 0.8 ? 'high' : result.score > 0.6 ? 'medium' : 'low',
        searchType: 'semantic',
        source: 'mem0_cloud'
      }));

      logger.info('Mem0 semantic search completed successfully', {
        query: query as string,
        userId: userId as string,
        resultsCount: formattedMemories.length,
        averageScore: formattedMemories.reduce((sum, m) => sum + m.score, 0) / formattedMemories.length
      });

      return res.status(200).json({
        success: true,
        message: `Found ${formattedMemories.length} semantically relevant memories`,
        data: {
          memories: formattedMemories,
          total: formattedMemories.length,
          query: query as string,
          searchType: 'semantic_mem0',
          searchEngine: 'mem0_cloud',
          capabilities: [
            'Semantic understanding',
            'Context-aware recall',
            'Natural language queries',
            'Temporal awareness',
            'Personal knowledge extraction'
          ]
        }
      });

    } catch (error) {
      logger.error('Error in Mem0 semantic search', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        queryParam: req.query.query as string,
        userIdParam: req.query.userId as string 
      });
      
      return res.status(500).json({
        success: false,
        message: 'Failed to perform semantic search',
        error: {
          code: 'MEM0_SEARCH_ERROR',
          details: 'Mem0 semantic search encountered an error. Please check your API key and connection.'
        }
      });
    }
  }

  /**
   * List all memories from DB (newest first)
   * GET /memories/list
   */
  static async listAllMemories(req: Request, res: Response) {
    try {
      const { page = 1, limit = 20, userId, memoryType } = req.query;
      const db = getDatabase();

      const skip = (Number(page) - 1) * Number(limit);
      const take = Number(limit);

      // Build filter conditions
      const whereConditions: any = {};
      if (userId) whereConditions.userId = userId;
      if (memoryType) whereConditions.memoryType = memoryType;

      const [memories, total] = await Promise.all([
        db.memory.findMany({
          where: whereConditions,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                phoneNumber: true,
                name: true,
              },
            },
            interaction: {
              select: {
                id: true,
                messageType: true,
                content: true,
              },
            },
            mediaFiles: true,
          },
        }),
        db.memory.count({ where: whereConditions }),
      ]);

      const totalPages = Math.ceil(total / take);

      logger.info('Retrieved all memories', {
        count: memories.length,
        total,
        page: Number(page),
        limit: Number(limit),
        filters: { userId, memoryType },
      });

      res.json({
        data: memories,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: totalPages,
          hasNext: Number(page) < totalPages,
          hasPrev: Number(page) > 1,
        },
      });

    } catch (error) {
      logger.error('Error retrieving all memories', { error });
      throw error;
    }
  }

  /**
   * Create memory from interaction with Mem0 integration (called by webhook)
   * This method is used internally by the webhook controller
   */
  static async createMemoryFromInteraction(
    userId: string,
    interactionId: string,
    content: string,
    memoryType: string,
    mediaUrls?: string[]
  ) {
    const db = getDatabase();
    const mem0Service = getMem0Service();

    // Create memory in Mem0 first
    const mem0Id = await mem0Service.createMemory({
      content: {
        text: content,
        metadata: {
          mediaUrls: mediaUrls || [],
        },
      },
      userId,
      interactionId,
      memoryType: memoryType as any,
      tags: [], // Will be enhanced with AI tagging in Phase 3
      importance: 1, // Default importance, will be enhanced in Phase 3
    });

    // Create memory in database with Mem0 ID
    const memory = await db.memory.create({
      data: {
        userId,
        interactionId,
        content,
        memoryType: memoryType as any,
        tags: [], // Will be enhanced with AI tagging in Phase 3
        importance: 1, // Default importance, will be enhanced in Phase 3
        mem0Id,
      },
    });

    // Update interaction status
    await db.interaction.update({
      where: { id: interactionId },
      data: { status: 'PROCESSED' },
    });

    logger.info('Memory created from interaction with Mem0', {
      memoryId: memory.id,
      mem0Id,
      interactionId,
      userId,
      memoryType,
    });

    return memory;
  }
}
