import { Request, Response } from 'express';
import { getReminderService } from '../services/reminderService';
import { getDatabase } from '../services/database';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export class ReminderController {
  /**
   * Create a new reminder
   * POST /reminders
   */
  static async createReminder(req: Request, res: Response) {
    try {
      const { userId, memoryId, scheduledFor, message, timezone, naturalLanguageTime } = req.body;
      const reminderService = getReminderService();

      let reminder;

      if (naturalLanguageTime) {
        // Parse natural language time expression
        reminder = await reminderService.parseAndCreateReminder(
          userId,
          memoryId,
          naturalLanguageTime,
          message
        );

        if (!reminder) {
          throw new BadRequestError(
            'Could not parse the time expression. Please use specific times like "tomorrow at 2 PM" or "in 2 hours"',
            ErrorCodes.INVALID_INPUT
          );
        }
      } else {
        // Create reminder with specific datetime
        reminder = await reminderService.createReminder({
          userId,
          memoryId,
          scheduledFor: new Date(scheduledFor),
          message,
          timezone,
        });
      }

      logger.info('Reminder created via API', {
        reminderId: reminder.id,
        userId,
        memoryId,
        scheduledFor: reminder.scheduledFor,
        naturalLanguageTime,
      });

      res.status(201).json({
        success: true,
        data: reminder,
      });
    } catch (error) {
      logger.error('Error creating reminder', { error });
      throw error;
    }
  }

  /**
   * Get user reminders
   * GET /reminders?status=pending&userId=123
   */
  static async getUserReminders(req: Request, res: Response) {
    try {
      const { userId, status } = req.query;
      const reminderService = getReminderService();

      if (!userId) {
        throw new BadRequestError('userId is required', ErrorCodes.INVALID_INPUT);
      }

      const reminders = await reminderService.getUserReminders(
        userId as string,
        status as 'PENDING' | 'SENT' | 'CANCELLED' | undefined
      );

      logger.info('Retrieved user reminders', {
        userId,
        status,
        count: reminders.length,
      });

      res.json({
        success: true,
        data: reminders,
      });
    } catch (error) {
      logger.error('Error getting user reminders', { error });
      throw error;
    }
  }

  /**
   * Cancel a reminder
   * DELETE /reminders/:reminderId
   */
  static async cancelReminder(req: Request, res: Response) {
    try {
      const { reminderId } = req.params;
      const { userId } = req.body;
      const reminderService = getReminderService();

      if (!userId) {
        throw new BadRequestError('userId is required', ErrorCodes.INVALID_INPUT);
      }

      const cancelled = await reminderService.cancelReminder(reminderId as string, userId as string);

      if (!cancelled) {
        throw new BadRequestError(
          'Reminder not found or cannot be cancelled',
          ErrorCodes.RESOURCE_NOT_FOUND
        );
      }

      logger.info('Reminder cancelled', {
        reminderId,
        userId,
      });

      res.json({
        success: true,
        message: 'Reminder cancelled successfully',
      });
    } catch (error) {
      logger.error('Error cancelling reminder', { error });
      throw error;
    }
  }

  /**
   * Get reminder statistics
   * GET /reminders/stats?userId=123
   */
  static async getReminderStats(req: Request, res: Response) {
    try {
      const { userId } = req.query;
      const reminderService = getReminderService();

      const stats = await reminderService.getReminderStats(userId as string | undefined);

      logger.info('Retrieved reminder statistics', {
        userId,
        stats,
      });

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Error getting reminder stats', { error });
      throw error;
    }
  }

  /**
   * Process due reminders manually (for testing)
   * POST /reminders/process
   */
  static async processReminders(req: Request, res: Response) {
    try {
      const reminderService = getReminderService();
      
      await reminderService.processScheduledReminders();

      logger.info('Manual reminder processing triggered');

      res.json({
        success: true,
        message: 'Reminder processing completed',
      });
    } catch (error) {
      logger.error('Error processing reminders manually', { error });
      throw error;
    }
  }

  /**
   * Create reminder from memory with smart time detection
   * POST /memories/:memoryId/reminders
   */
  static async createReminderFromMemory(req: Request, res: Response) {
    try {
      const { memoryId } = req.params;
      const { userId, timeExpression, customMessage } = req.body;
      const db = getDatabase();
      const reminderService = getReminderService();

      // Verify memory exists and belongs to user
      const memory = await db.memory.findUnique({
        where: {
          id: memoryId,
          userId: userId,
        },
      });

      if (!memory) {
        throw new BadRequestError(
          'Memory not found or does not belong to user',
          ErrorCodes.RESOURCE_NOT_FOUND
        );
      }

      // Create default reminder message if not provided
      const defaultMessage = customMessage || `Reminder about: ${memory.content.substring(0, 100)}${memory.content.length > 100 ? '...' : ''}`;

      // Create reminder using natural language time
      const reminder = await reminderService.parseAndCreateReminder(
        userId as string,
        memoryId as string,
        timeExpression,
        defaultMessage
      );

      if (!reminder) {
        throw new BadRequestError(
          'Could not understand the time expression. Try: "tomorrow at 2 PM", "in 1 hour", "next Monday"',
          ErrorCodes.INVALID_INPUT
        );
      }

      logger.info('Reminder created from memory', {
        reminderId: reminder.id,
        memoryId,
        userId,
        timeExpression,
      });

      res.status(201).json({
        success: true,
        data: reminder,
        message: 'Reminder created successfully',
      });
    } catch (error) {
      logger.error('Error creating reminder from memory', { error });
      throw error;
    }
  }
}
