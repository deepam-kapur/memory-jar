import express from 'express';
import { validate } from '../middleware/validation';
import { sanitize, validatePhoneNumber, validateCuid } from '../middleware/validation';
import { apiLimiter } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { schemas } from '../validation/schemas';
import { getDatabase } from '../services/database';
import { NotFoundError, ConflictError, ErrorCodes } from '../utils/errors';
import logger from '../config/logger';

const router = express.Router();

// Apply rate limiting to all user routes
router.use(apiLimiter);

// Apply sanitization to all routes
router.use(sanitize);

// GET /users - Get all users (with pagination)
router.get('/', 
  validate(schemas.pagination, 'query'),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const db = getDatabase();
    
    const skip = (page - 1) * limit;
    
    const [users, total] = await Promise.all([
      db.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phoneNumber: true,
          name: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              interactions: true,
              memories: true,
              mediaFiles: true,
            },
          },
        },
      }),
      db.user.count(),
    ]);

    logger.info('Users retrieved', {
      count: users.length,
      total,
      page,
      limit,
      requestId: req.id,
    });

    res.json({
      data: users,
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

// GET /users/:userId - Get user by ID
router.get('/:userId',
  validate(schemas.getUser, 'params'),
  validateCuid,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const db = getDatabase();
    
    const user = await db.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            interactions: true,
            memories: true,
            mediaFiles: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User not found', ErrorCodes.RESOURCE_NOT_FOUND);
    }

    logger.info('User retrieved', {
      userId,
      requestId: req.id,
    });

    res.json({ data: user });
  })
);

// POST /users - Create new user
router.post('/',
  validate(schemas.createUser),
  validatePhoneNumber,
  asyncHandler(async (req, res) => {
    const { phoneNumber, name } = req.body;
    const db = getDatabase();
    
    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { phoneNumber },
    });

    if (existingUser) {
      throw new ConflictError('User with this phone number already exists', ErrorCodes.RESOURCE_ALREADY_EXISTS);
    }

    const user = await db.user.create({
      data: {
        phoneNumber,
        name,
      },
    });

    logger.info('User created', {
      userId: user.id,
      phoneNumber,
      requestId: req.id,
    });

    res.status(201).json({ data: user });
  })
);

// PUT /users/:userId - Update user
router.put('/:userId',
  validate(schemas.getUser, 'params'),
  validate(schemas.updateUser),
  validateCuid,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const updateData = req.body;
    const db = getDatabase();
    
    // Check if user exists
    const existingUser = await db.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      throw new NotFoundError('User not found', ErrorCodes.RESOURCE_NOT_FOUND);
    }

    const user = await db.user.update({
      where: { id: userId },
      data: updateData,
    });

    logger.info('User updated', {
      userId,
      updateData,
      requestId: req.id,
    });

    res.json({ data: user });
  })
);

// DELETE /users/:userId - Delete user (soft delete)
router.delete('/:userId',
  validate(schemas.getUser, 'params'),
  validateCuid,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const db = getDatabase();
    
    // Check if user exists
    const existingUser = await db.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      throw new NotFoundError('User not found', ErrorCodes.RESOURCE_NOT_FOUND);
    }

    // Soft delete by setting isActive to false
    const user = await db.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    logger.info('User deactivated', {
      userId,
      requestId: req.id,
    });

    res.json({ 
      data: user,
      message: 'User deactivated successfully' 
    });
  })
);

// GET /users/:userId/interactions - Get user interactions
router.get('/:userId/interactions',
  validate(schemas.getUser, 'params'),
  validate(schemas.getInteractions, 'query'),
  validateCuid,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { page, limit, messageType, direction, status, startDate, endDate } = req.query;
    const db = getDatabase();
    
    // Check if user exists
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found', ErrorCodes.RESOURCE_NOT_FOUND);
    }

    const skip = (page - 1) * limit;
    
    // Build where clause
    const where: any = { userId };
    
    if (messageType) where.messageType = messageType;
    if (direction) where.direction = direction;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate);
      if (endDate) where.timestamp.lte = new Date(endDate);
    }

    const [interactions, total] = await Promise.all([
      db.interaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
        },
      }),
      db.interaction.count({ where }),
    ]);

    logger.info('User interactions retrieved', {
      userId,
      count: interactions.length,
      total,
      requestId: req.id,
    });

    res.json({
      data: interactions,
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

// GET /users/:userId/memories - Get user memories
router.get('/:userId/memories',
  validate(schemas.getUser, 'params'),
  validate(schemas.getMemories, 'query'),
  validateCuid,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { page, limit, memoryType, tags, minImportance, maxImportance, startDate, endDate } = req.query;
    const db = getDatabase();
    
    // Check if user exists
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found', ErrorCodes.RESOURCE_NOT_FOUND);
    }

    const skip = (page - 1) * limit;
    
    // Build where clause
    const where: any = { userId };
    
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
        },
      }),
      db.memory.count({ where }),
    ]);

    logger.info('User memories retrieved', {
      userId,
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
    });
  })
);

export default router;
