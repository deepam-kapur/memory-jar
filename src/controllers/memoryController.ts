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
   * Search memories using Mem0 for semantic search
   * GET /memories?query=<text>
   */
  static async searchMemories(req: Request, res: Response) {
    try {
      const { query, page = 1, limit = 20, userId, memoryType, tags, minImportance, maxImportance } = req.query;
      const db = getDatabase();
      const mem0Service = getMem0Service();

      // Search memories using Mem0 for semantic search
      const mem0Results = await mem0Service.searchMemories(
        query as string,
        userId as string,
        Number(limit) * 2 // Get more results to filter
      );

      // Extract memory IDs from Mem0 results
      const memoryIds = mem0Results.map(result => result.id);

      // Build where conditions for database filtering
      const whereConditions: any = {
        mem0Id: {
          in: memoryIds,
        },
      };

      // Add optional filters
      if (userId) {
        whereConditions.userId = userId;
      }

      if (memoryType) {
        whereConditions.memoryType = memoryType;
      }

      if (tags && Array.isArray(tags)) {
        whereConditions.tags = {
          hasSome: tags,
        };
      }

      if (minImportance || maxImportance) {
        whereConditions.importance = {};
        if (minImportance) whereConditions.importance.gte = Number(minImportance);
        if (maxImportance) whereConditions.importance.lte = Number(maxImportance);
      }

      // Get memories from database with Mem0 IDs
      const memories = await db.memory.findMany({
        where: whereConditions,
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        orderBy: { lastAccessed: 'desc' },
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

      const total = await db.memory.count({
        where: whereConditions,
      });

      // Update access count and last accessed for found memories
      if (memories.length > 0) {
        // Use individual updates instead of updateMany for better compatibility
        const updatePromises = memories.map(memory => 
          db.memory.update({
            where: { id: memory.id },
            data: {
              accessCount: { increment: 1 },
              lastAccessed: new Date(),
            },
          })
        );
        await Promise.all(updatePromises);
      }

      logger.info('Memories searched with Mem0', {
        query,
        resultsCount: memories.length,
        mem0ResultsCount: mem0Results.length,
        total,
        filters: { userId, memoryType, tags, minImportance, maxImportance },
        requestId: req.id,
      });

      res.json({
        data: memories,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
          hasNext: Number(page) * Number(limit) < total,
          hasPrev: Number(page) > 1,
        },
        search: {
          query,
          resultsCount: memories.length,
          filters: { userId, memoryType, tags, minImportance, maxImportance },
          semanticSearch: true,
        },
      });

    } catch (error) {
      logger.error('Error searching memories', { error });
      throw error;
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
