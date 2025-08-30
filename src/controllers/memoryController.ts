import { Request, Response } from 'express';
import { getDatabase } from '../services/database';
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

      // TODO: Integrate with Mem0 for semantic memory storage
      // const mem0Id = await createMem0Memory(content, memoryType, tags);

      const memory = await db.memory.create({
        data: {
          userId,
          interactionId,
          content,
          memoryType,
          tags: tags || [],
          importance: importance || 1,
          // mem0Id, // Will be added when Mem0 integration is complete
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

      logger.info('Memory created', {
        memoryId: memory.id,
        userId,
        memoryType,
        requestId: req.id,
      });

      res.status(201).json({ data: memory });

    } catch (error) {
      logger.error('Error creating memory', { error });
      throw error;
    }
  }

  /**
   * Search memories via Mem0 and enrich with DB
   * GET /memories?query=<text>
   */
  static async searchMemories(req: Request, res: Response) {
    try {
      const { query, page = 1, limit = 20 } = req.query;
      const db = getDatabase();

      // TODO: Integrate with Mem0 for semantic search
      // const mem0Results = await searchMem0(query);
      // const memoryIds = mem0Results.map(result => result.memoryId);

      // For now, perform basic text search in database
      const memories = await db.memory.findMany({
        where: {
          content: {
            contains: query as string,
            mode: 'insensitive',
          },
        },
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
        where: {
          content: {
            contains: query as string,
            mode: 'insensitive',
          },
        },
      });

      // TODO: Update access count for found memories
      // await db.memory.updateMany({
      //   where: { id: { in: memories.map(m => m.id) } },
      //   data: {
      //     accessCount: { increment: 1 },
      //     lastAccessed: new Date(),
      //   },
      // });

      logger.info('Memories searched', {
        query,
        resultsCount: memories.length,
        total,
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
      const { page = 1, limit = 20 } = req.query;
      const db = getDatabase();

      const skip = (Number(page) - 1) * Number(limit);
      const take = Number(limit);

      const [memories, total] = await Promise.all([
        db.memory.findMany({
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
          },
        }),
        db.memory.count(),
      ]);

      const totalPages = Math.ceil(total / take);

      logger.info('Retrieved all memories', {
        count: memories.length,
        total,
        page: Number(page),
        limit: Number(limit),
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
}
