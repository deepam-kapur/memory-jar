import express from 'express';
import { validate } from '../middleware/validation';
import { sanitize, validateCuid } from '../middleware/validation';
import { apiLimiter, searchLimiter } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { schemas } from '../validation/schemas';
import { getDatabase } from '../services/database';
import { NotFoundError, BadRequestError, ErrorCodes } from '../utils/errors';
import logger from '../config/logger';

const router = express.Router();

// Apply rate limiting to all memory routes
router.use(apiLimiter);

// Apply sanitization to all routes
router.use(sanitize);

// GET /memories - Get all memories (with filtering and pagination)
router.get('/',
  validate(schemas.getMemories, 'query'),
  asyncHandler(async (req, res) => {
    const { 
      page, 
      limit, 
      userId, 
      memoryType, 
      tags, 
      minImportance, 
      maxImportance, 
      startDate, 
      endDate 
    } = req.query;
    const db = getDatabase();
    
    const skip = (page - 1) * limit;
    
    // Build where clause
    const where: any = {};
    
    if (userId) where.userId = userId;
    if (memoryType) where.memoryType = memoryType;
    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags };
    }
    if (minImportance || maxImportance) {
      where.importance = {};
      if (minImportance) where.importance.gte = minImportance;
      if (maxImportance) where.importance.lte = maxImportance;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [memories, total] = await Promise.all([
      db.memory.findMany({
        where,
        skip,
        take: limit,
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
          mediaFiles: {
            select: {
              id: true,
              fileName: true,
              fileType: true,
              s3Url: true,
            },
          },
        },
      }),
      db.memory.count({ where }),
    ]);

    logger.info('Memories retrieved', {
      count: memories.length,
      total,
      filters: { userId, memoryType, tags, minImportance, maxImportance },
      requestId: req.id,
    });

    res.json({
      data: memories,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  })
);

// GET /memories/search - Search memories
router.get('/search',
  validate(schemas.searchMemories, 'query'),
  searchLimiter,
  asyncHandler(async (req, res) => {
    const { 
      query, 
      userId, 
      memoryType, 
      tags, 
      minImportance, 
      maxImportance, 
      page, 
      limit 
    } = req.query;
    const db = getDatabase();
    
    const skip = (page - 1) * limit;
    
    // Build where clause
    const where: any = {
      OR: [
        { content: { contains: query, mode: 'insensitive' } },
        { tags: { hasSome: [query] } },
      ],
    };
    
    if (userId) where.userId = userId;
    if (memoryType) where.memoryType = memoryType;
    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags };
    }
    if (minImportance || maxImportance) {
      where.importance = {};
      if (minImportance) where.importance.gte = minImportance;
      if (maxImportance) where.importance.lte = maxImportance;
    }

    const [memories, total] = await Promise.all([
      db.memory.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { importance: 'desc' },
          { lastAccessed: 'desc' },
        ],
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
          mediaFiles: {
            select: {
              id: true,
              fileName: true,
              fileType: true,
              s3Url: true,
            },
          },
        },
      }),
      db.memory.count({ where }),
    ]);

    // Update access count and last accessed for retrieved memories
    if (memories.length > 0) {
      await db.memory.updateMany({
        where: { id: { in: memories.map(m => m.id) } },
        data: {
          accessCount: { increment: 1 },
          lastAccessed: new Date(),
        },
      });
    }

    logger.info('Memory search performed', {
      query,
      count: memories.length,
      total,
      requestId: req.id,
    });

    res.json({
      data: memories,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
      search: {
        query,
        resultsCount: memories.length,
      },
    });
  })
);

// GET /memories/:memoryId - Get memory by ID
router.get('/:memoryId',
  validate(schemas.getUser, 'params'), // Reusing user schema for CUID validation
  validateCuid,
  asyncHandler(async (req, res) => {
    const { memoryId } = req.params;
    const db = getDatabase();
    
    const memory = await db.memory.findUnique({
      where: { id: memoryId },
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
            timestamp: true,
          },
        },
        mediaFiles: {
          select: {
            id: true,
            fileName: true,
            originalName: true,
            fileType: true,
            fileSize: true,
            s3Url: true,
            transcription: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    });

    if (!memory) {
      throw new NotFoundError('Memory not found', ErrorCodes.RESOURCE_NOT_FOUND);
    }

    // Update access count and last accessed
    await db.memory.update({
      where: { id: memoryId },
      data: {
        accessCount: { increment: 1 },
        lastAccessed: new Date(),
      },
    });

    logger.info('Memory retrieved', {
      memoryId,
      requestId: req.id,
    });

    res.json({ data: memory });
  })
);

// POST /memories - Create new memory
router.post('/',
  validate(schemas.createMemory),
  validateCuid,
  asyncHandler(async (req, res) => {
    const { userId, interactionId, content, mem0Id, memoryType, tags, importance } = req.body;
    const db = getDatabase();
    
    // Check if user exists
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found', ErrorCodes.RESOURCE_NOT_FOUND);
    }

    // Check if interaction exists (if provided)
    if (interactionId) {
      const interaction = await db.interaction.findUnique({
        where: { id: interactionId },
      });

      if (!interaction) {
        throw new NotFoundError('Interaction not found', ErrorCodes.RESOURCE_NOT_FOUND);
      }

      // Verify interaction belongs to the user
      if (interaction.userId !== userId) {
        throw new BadRequestError('Interaction does not belong to user', ErrorCodes.INVALID_INPUT);
      }
    }

    const memory = await db.memory.create({
      data: {
        userId,
        interactionId,
        content,
        mem0Id,
        memoryType,
        tags: tags || [],
        importance,
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
  })
);

// PUT /memories/:memoryId - Update memory
router.put('/:memoryId',
  validate(schemas.getUser, 'params'), // Reusing user schema for CUID validation
  validate(schemas.updateMemory),
  validateCuid,
  asyncHandler(async (req, res) => {
    const { memoryId } = req.params;
    const updateData = req.body;
    const db = getDatabase();
    
    // Check if memory exists
    const existingMemory = await db.memory.findUnique({
      where: { id: memoryId },
    });

    if (!existingMemory) {
      throw new NotFoundError('Memory not found', ErrorCodes.RESOURCE_NOT_FOUND);
    }

    const memory = await db.memory.update({
      where: { id: memoryId },
      data: updateData,
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

    logger.info('Memory updated', {
      memoryId,
      updateData,
      requestId: req.id,
    });

    res.json({ data: memory });
  })
);

// DELETE /memories/:memoryId - Delete memory
router.delete('/:memoryId',
  validate(schemas.getUser, 'params'), // Reusing user schema for CUID validation
  validateCuid,
  asyncHandler(async (req, res) => {
    const { memoryId } = req.params;
    const db = getDatabase();
    
    // Check if memory exists
    const existingMemory = await db.memory.findUnique({
      where: { id: memoryId },
    });

    if (!existingMemory) {
      throw new NotFoundError('Memory not found', ErrorCodes.RESOURCE_NOT_FOUND);
    }

    // Delete related media files first
    await db.mediaFile.deleteMany({
      where: { memoryId },
    });

    // Delete the memory
    await db.memory.delete({
      where: { id: memoryId },
    });

    logger.info('Memory deleted', {
      memoryId,
      requestId: req.id,
    });

    res.json({ 
      message: 'Memory deleted successfully',
      memoryId,
    });
  })
);

// GET /memories/tags - Get all unique tags
router.get('/tags/all',
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    
    const memories = await db.memory.findMany({
      select: { tags: true },
      where: { tags: { isEmpty: false } },
    });

    // Extract and count all tags
    const tagCounts: Record<string, number> = {};
    memories.forEach(memory => {
      memory.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });

    const tags = Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    logger.info('Memory tags retrieved', {
      uniqueTags: tags.length,
      requestId: req.id,
    });

    res.json({ data: tags });
  })
);

// GET /memories/stats - Get memory statistics
router.get('/stats/overview',
  asyncHandler(async (req, res) => {
    const db = getDatabase();
    
    const [
      totalMemories,
      totalUsers,
      memoriesByType,
      averageImportance,
      recentMemories,
    ] = await Promise.all([
      db.memory.count(),
      db.user.count(),
      db.memory.groupBy({
        by: ['memoryType'],
        _count: { id: true },
      }),
      db.memory.aggregate({
        _avg: { importance: true },
      }),
      db.memory.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
      }),
    ]);

    const stats = {
      totalMemories,
      totalUsers,
      memoriesByType: memoriesByType.map(item => ({
        type: item.memoryType,
        count: item._count.id,
      })),
      averageImportance: Math.round(averageImportance._avg.importance || 0),
      recentMemories,
      topAccessedMemories: await db.memory.findMany({
        take: 5,
        orderBy: { accessCount: 'desc' },
        select: {
          id: true,
          content: true,
          accessCount: true,
          importance: true,
        },
      }),
    };

    logger.info('Memory statistics retrieved', {
      requestId: req.id,
    });

    res.json({ data: stats });
  })
);

export default router;
