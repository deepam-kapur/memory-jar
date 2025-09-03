import { Request, Response } from 'express';
import { getDatabase } from '../services/database';
import { getReminderService } from '../services/reminderService';
import { getTimezoneService } from '../services/timezoneService';
import { NotFoundError, BadRequestError, ErrorCodes } from '../utils/errors';
import logger from '../config/logger';

export class ReminderController {
  /**
   * Create a new reminder
   * POST /reminders
   */
  static async createReminder(req: Request, res: Response) {
    try {
      const { userId, memoryId, scheduledFor, message, timezone } = req.body;
      const reminderService = getReminderService();

      const reminder = await reminderService.createReminder({
        userId,
        memoryId,
        scheduledFor: new Date(scheduledFor),
        message,
        timezone,
      });

      logger.info('Reminder created via API', {
        reminderId: reminder.id,
        userId,
        memoryId,
        scheduledFor: reminder.scheduledFor,
        requestId: req.id,
      });

      res.status(201).json({ data: reminder });

    } catch (error) {
      logger.error('Error creating reminder', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Parse natural language time and create reminder
   * POST /reminders/parse
   */
  static async parseAndCreateReminder(req: Request, res: Response) {
    try {
      const { userId, memoryId, naturalLanguageTime, message } = req.body;
      const reminderService = getReminderService();

      const reminder = await reminderService.parseAndCreateReminder(
        userId,
        memoryId,
        naturalLanguageTime,
        message
      );

      if (!reminder) {
        throw new BadRequestError(
          'Could not parse the time expression. Please try a different format like "tomorrow at 3 PM" or "in 2 hours".',
          ErrorCodes.INVALID_INPUT
        );
      }

      logger.info('Reminder created via natural language parsing', {
        reminderId: reminder.id,
        userId,
        memoryId,
        naturalLanguageTime,
        parsedTime: reminder.scheduledFor,
        requestId: req.id,
      });

      res.status(201).json({ 
        data: reminder,
        parsing: {
          input: naturalLanguageTime,
          parsed: reminder.scheduledFor,
          confidence: 'high' // Could be enhanced with actual confidence scoring
        }
      });

    } catch (error) {
      logger.error('Error parsing and creating reminder', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Get user's reminders with optional filtering
   * GET /reminders
   */
  static async getUserReminders(req: Request, res: Response) {
    try {
      const { userId, status, page = 1, limit = 20 } = req.query;
      const reminderService = getReminderService();

      if (!userId) {
        throw new BadRequestError('userId is required', ErrorCodes.MISSING_REQUIRED_FIELD);
      }

      const skip = (Number(page) - 1) * Number(limit);
      const take = Number(limit);

      // Get reminders from service
      const reminders = await reminderService.getUserReminders(
        userId as string, 
        status as 'PENDING' | 'SENT' | 'CANCELLED' | undefined
      );

      // Apply pagination
      const paginatedReminders = reminders.slice(skip, skip + take);
      const total = reminders.length;
      const totalPages = Math.ceil(total / take);

      logger.info('Retrieved user reminders', {
        userId,
        status,
        count: paginatedReminders.length,
        total,
        page: Number(page),
        limit: Number(limit),
        requestId: req.id,
      });

      res.json({
        data: paginatedReminders,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: totalPages,
          hasNext: Number(page) < totalPages,
          hasPrev: Number(page) > 1,
        },
        filters: {
          userId,
          status,
        },
      });

    } catch (error) {
      logger.error('Error retrieving user reminders', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Cancel a pending reminder
   * PATCH /reminders/:id/cancel
   */
  static async cancelReminder(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { userId } = req.body;
      const reminderService = getReminderService();

      if (!userId) {
        throw new BadRequestError('userId is required', ErrorCodes.MISSING_REQUIRED_FIELD);
      }

      const cancelled = await reminderService.cancelReminder(id, userId);

      if (!cancelled) {
        throw new NotFoundError(
          'Reminder not found or cannot be cancelled',
          ErrorCodes.RESOURCE_NOT_FOUND
        );
      }

      logger.info('Reminder cancelled', {
        reminderId: id,
        userId,
        requestId: req.id,
      });

      res.json({
        data: {
          id,
          status: 'CANCELLED',
          cancelledAt: new Date().toISOString(),
        },
        message: 'Reminder cancelled successfully',
      });

    } catch (error) {
      logger.error('Error cancelling reminder', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Get upcoming reminders (next 24 hours)
   * GET /reminders/upcoming
   */
  static async getUpcomingReminders(req: Request, res: Response) {
    try {
      const { userId, limit = 10 } = req.query;
      const db = getDatabase();

      if (!userId) {
        throw new BadRequestError('userId is required', ErrorCodes.MISSING_REQUIRED_FIELD);
      }

      const now = new Date();
      const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const upcomingReminders = await db.reminder.findMany({
        where: {
          userId: userId as string,
          status: 'PENDING',
          scheduledFor: {
            gte: now,
            lte: next24Hours,
          },
        },
        take: Number(limit),
        orderBy: { scheduledFor: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              phoneNumber: true,
              timezone: true,
            },
          },
          memory: {
            select: {
              id: true,
              content: true,
              memoryType: true,
            },
          },
        },
      });

      logger.info('Retrieved upcoming reminders', {
        userId,
        count: upcomingReminders.length,
        timeWindow: '24 hours',
        requestId: req.id,
      });

      res.json({
        data: upcomingReminders,
        meta: {
          timeWindow: {
            from: now.toISOString(),
            to: next24Hours.toISOString(),
          },
          count: upcomingReminders.length,
          limit: Number(limit),
        },
      });

    } catch (error) {
      logger.error('Error retrieving upcoming reminders', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Get reminder statistics
   * GET /reminders/stats
   */
  static async getReminderStats(req: Request, res: Response) {
    try {
      const { userId } = req.query;
      const reminderService = getReminderService();

      const stats = await reminderService.getReminderStats(userId as string | undefined);

      // Get additional detailed stats
      const db = getDatabase();
      const now = new Date();
      
      // Get stats for different time periods
      const [todayStats, weekStats, monthStats] = await Promise.all([
        // Today's reminders
        db.reminder.count({
          where: {
            ...(userId && { userId: userId as string }),
            scheduledFor: {
              gte: new Date(now.setHours(0, 0, 0, 0)),
              lt: new Date(now.setHours(23, 59, 59, 999)),
            },
          },
        }),
        // This week's reminders
        db.reminder.count({
          where: {
            ...(userId && { userId: userId as string }),
            scheduledFor: {
              gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
              lte: now,
            },
          },
        }),
        // This month's reminders
        db.reminder.count({
          where: {
            ...(userId && { userId: userId as string }),
            scheduledFor: {
              gte: new Date(now.getFullYear(), now.getMonth(), 1),
              lte: now,
            },
          },
        }),
      ]);

      // Calculate success rate
      const successRate = stats.total > 0 ? ((stats.sent / stats.total) * 100).toFixed(1) : '0';

      const enhancedStats = {
        ...stats,
        timeBreakdown: {
          today: todayStats,
          thisWeek: weekStats,
          thisMonth: monthStats,
        },
        performance: {
          successRate: `${successRate}%`,
          failureRate: stats.total > 0 ? `${((stats.cancelled / stats.total) * 100).toFixed(1)}%` : '0%',
        },
        generatedAt: new Date().toISOString(),
      };

      logger.info('Generated reminder statistics', {
        userId: userId || 'all_users',
        totalReminders: stats.total,
        successRate,
        requestId: req.id,
      });

      res.json({
        data: enhancedStats,
      });

    } catch (error) {
      logger.error('Error generating reminder statistics', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Get reminder service health status
   * GET /reminders/health
   */
  static async getServiceHealth(req: Request, res: Response) {
    try {
      const reminderService = getReminderService();
      const healthStatus = await reminderService.healthCheck();

      logger.info('Reminder service health check completed', {
        status: healthStatus.status,
        requestId: req.id,
      });

      res.json({
        data: healthStatus,
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      logger.error('Error checking reminder service health', { error, requestId: req.id });
      
      res.status(503).json({
        data: {
          status: 'unhealthy',
          details: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get reminder details by ID
   * GET /reminders/:id
   */
  static async getReminderById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { userId } = req.query;
      const db = getDatabase();

      const reminder = await db.reminder.findFirst({
        where: {
          id,
          ...(userId && { userId: userId as string }),
        },
        include: {
          user: {
            select: {
              id: true,
              phoneNumber: true,
              timezone: true,
            },
          },
          memory: {
            select: {
              id: true,
              content: true,
              memoryType: true,
              createdAt: true,
            },
          },
        },
      });

      if (!reminder) {
        throw new NotFoundError('Reminder not found', ErrorCodes.RESOURCE_NOT_FOUND);
      }

      logger.info('Retrieved reminder details', {
        reminderId: id,
        userId: reminder.userId,
        status: reminder.status,
        requestId: req.id,
      });

      res.json({ data: reminder });

    } catch (error) {
      logger.error('Error retrieving reminder details', { error, requestId: req.id });
      throw error;
    }
  }
}