import { getDatabase } from './database';
import { getTwilioService } from './twilioService';
import { getTimezoneService } from './timezoneService';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';
import * as cron from 'node-cron';

export interface CreateReminderOptions {
  userId: string;
  memoryId: string;
  scheduledFor: Date;
  message: string;
  timezone?: string;
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly';
}

export interface ReminderWithDetails {
  id: string;
  userId: string;
  memoryId: string;
  scheduledFor: Date;
  message: string;
  status: 'PENDING' | 'SENT' | 'CANCELLED';
  createdAt: Date;
  updatedAt: Date;
  user: {
    phoneNumber: string;
    timezone: string;
  };
  memory: {
    content: string;
    memoryType: string;
  };
}

export class ReminderService {
  private static instance: ReminderService | null = null;
  private reminderJob: cron.ScheduledTask | null = null;
  private isJobRunning = false;

  constructor() {
    this.initializeReminderJob();
  }

  static getInstance(): ReminderService {
    if (!ReminderService.instance) {
      ReminderService.instance = new ReminderService();
    }
    return ReminderService.instance;
  }

  /**
   * Initialize background job to process reminders every minute
   */
  private initializeReminderJob(): void {
    try {
      // Run every minute to check for pending reminders
      this.reminderJob = cron.schedule('* * * * *', async () => {
        if (!this.isJobRunning) {
          this.isJobRunning = true;
          await this.processScheduledReminders();
          this.isJobRunning = false;
        }
      }, {
        scheduled: true,
        timezone: 'UTC' // Process in UTC, but consider user timezones
      });

      logger.info('Reminder job initialized successfully', {
        schedule: 'every minute',
        timezone: 'UTC'
      });
    } catch (error) {
      logger.error('Failed to initialize reminder job', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Create a new scheduled reminder
   */
  async createReminder(options: CreateReminderOptions): Promise<ReminderWithDetails> {
    try {
      const db = getDatabase();
      const timezoneService = getTimezoneService();

      // Validate user exists
      const user = await db.user.findUnique({
        where: { id: options.userId },
        select: { id: true, phoneNumber: true, timezone: true }
      });

      if (!user) {
        throw new BadRequestError('User not found', ErrorCodes.RESOURCE_NOT_FOUND);
      }

      // Validate memory exists and belongs to user
      const memory = await db.memory.findUnique({
        where: { 
          id: options.memoryId,
          userId: options.userId 
        },
        select: { id: true, content: true, memoryType: true }
      });

      if (!memory) {
        throw new BadRequestError('Memory not found or does not belong to user', ErrorCodes.RESOURCE_NOT_FOUND);
      }

      // Convert scheduled time to UTC for storage
      const userTimezone = options.timezone || user.timezone;
      // For now, just use the provided date as-is (in production, you'd want proper timezone conversion)
      const scheduledForUTC = new Date(options.scheduledFor);

      // Validate reminder is in the future
      if (scheduledForUTC <= new Date()) {
        throw new BadRequestError('Reminder must be scheduled for a future time', ErrorCodes.INVALID_INPUT);
      }

      // Create reminder in database
      const reminder = await db.reminder.create({
        data: {
          userId: options.userId,
          memoryId: options.memoryId,
          scheduledFor: scheduledForUTC,
          message: options.message,
          status: 'PENDING'
        },
        include: {
          user: {
            select: {
              phoneNumber: true,
              timezone: true
            }
          },
          memory: {
            select: {
              content: true,
              memoryType: true
            }
          }
        }
      });

      logger.info('Reminder created successfully', {
        reminderId: reminder.id,
        userId: options.userId,
        memoryId: options.memoryId,
        scheduledFor: scheduledForUTC.toISOString(),
        userTimezone
      });

      return reminder;
    } catch (error) {
      logger.error('Failed to create reminder', {
        error: error instanceof Error ? error.message : 'Unknown error',
        options
      });
      
      if (error instanceof BadRequestError) {
        throw error;
      }
      
      throw new BadRequestError(
        `Failed to create reminder: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.INTERNAL_ERROR
      );
    }
  }

  /**
   * Process all pending reminders that are due
   */
  async processScheduledReminders(): Promise<void> {
    try {
      const db = getDatabase();
      const twilioService = getTwilioService();
      const now = new Date();

      // Find all pending reminders that are due
      const dueReminders = await db.reminder.findMany({
        where: {
          status: 'PENDING',
          scheduledFor: {
            lte: now
          }
        },
        include: {
          user: {
            select: {
              phoneNumber: true,
              timezone: true
            }
          },
          memory: {
            select: {
              content: true,
              memoryType: true
            }
          }
        },
        orderBy: {
          scheduledFor: 'asc'
        }
      });

      if (dueReminders.length === 0) {
        return; // No reminders to process
      }

      logger.info('Processing due reminders', {
        count: dueReminders.length,
        checkTime: now.toISOString()
      });

      // Process each reminder
      for (const reminder of dueReminders) {
        try {
          await this.sendReminderMessage(reminder);
          
          // Mark reminder as sent
          await db.reminder.update({
            where: { id: reminder.id },
            data: { 
              status: 'SENT',
              updatedAt: new Date()
            }
          });

          logger.info('Reminder sent successfully', {
            reminderId: reminder.id,
            userId: reminder.userId,
            phoneNumber: reminder.user.phoneNumber
          });

        } catch (error) {
          logger.error('Failed to send reminder', {
            reminderId: reminder.id,
            userId: reminder.userId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });

          // Mark reminder as failed (we could retry later)
          await db.reminder.update({
            where: { id: reminder.id },
            data: { 
              status: 'CANCELLED', // or create a 'FAILED' status
              updatedAt: new Date()
            }
          });
        }
      }

    } catch (error) {
      logger.error('Error processing scheduled reminders', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send reminder message via WhatsApp
   */
  private async sendReminderMessage(reminder: ReminderWithDetails): Promise<void> {
    try {
      const twilioService = getTwilioService();
      const whatsappNumber = `whatsapp:${reminder.user.phoneNumber}`;

      // Format reminder message
      const message = this.formatReminderMessage(reminder);

      await twilioService.sendWhatsAppMessage(whatsappNumber, message);

      logger.info('Reminder WhatsApp message sent', {
        reminderId: reminder.id,
        to: whatsappNumber,
        messageLength: message.length
      });

    } catch (error) {
      logger.error('Failed to send reminder WhatsApp message', {
        reminderId: reminder.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Format reminder message for WhatsApp
   */
  private formatReminderMessage(reminder: ReminderWithDetails): string {
    const memoryPreview = reminder.memory.content.length > 100 
      ? reminder.memory.content.substring(0, 100) + '...'
      : reminder.memory.content;

    let message = `🔔 *Reminder*\n\n`;
    message += `📝 ${reminder.message}\n\n`;
    message += `💭 *Related Memory:*\n"${memoryPreview}"\n\n`;
    
    // Add memory type indicator
    const typeEmojis = {
      'TEXT': '📝',
      'IMAGE': '📸',
      'AUDIO': '🎤',
      'VIDEO': '📹',
      'MIXED': '📎'
    };
    
    message += `${typeEmojis[reminder.memory.memoryType as keyof typeof typeEmojis] || '📝'} Type: ${reminder.memory.memoryType}\n\n`;
    message += `_Scheduled reminder delivered_`;

    return message;
  }

  /**
   * Get pending reminders for a user
   */
  async getUserReminders(userId: string, status?: 'PENDING' | 'SENT' | 'CANCELLED'): Promise<ReminderWithDetails[]> {
    try {
      const db = getDatabase();

      const whereConditions: any = { userId };
      if (status) {
        whereConditions.status = status;
      }

      const reminders = await db.reminder.findMany({
        where: whereConditions,
        include: {
          user: {
            select: {
              phoneNumber: true,
              timezone: true
            }
          },
          memory: {
            select: {
              content: true,
              memoryType: true
            }
          }
        },
        orderBy: {
          scheduledFor: 'asc'
        }
      });

      return reminders;
    } catch (error) {
      logger.error('Failed to get user reminders', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        status
      });
      return [];
    }
  }

  /**
   * Cancel a pending reminder
   */
  async cancelReminder(reminderId: string, userId: string): Promise<boolean> {
    try {
      const db = getDatabase();

      const reminder = await db.reminder.findUnique({
        where: { 
          id: reminderId,
          userId: userId,
          status: 'PENDING'
        }
      });

      if (!reminder) {
        return false;
      }

      await db.reminder.update({
        where: { id: reminderId },
        data: { 
          status: 'CANCELLED',
          updatedAt: new Date()
        }
      });

      logger.info('Reminder cancelled', {
        reminderId,
        userId
      });

      return true;
    } catch (error) {
      logger.error('Failed to cancel reminder', {
        error: error instanceof Error ? error.message : 'Unknown error',
        reminderId,
        userId
      });
      return false;
    }
  }

  /**
   * Parse natural language time expressions and create reminders
   */
  async parseAndCreateReminder(
    userId: string, 
    memoryId: string, 
    naturalLanguageTime: string,
    message: string
  ): Promise<ReminderWithDetails | null> {
    try {
      const timezoneService = getTimezoneService();
      
      // Get user timezone
      const db = getDatabase();
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { timezone: true }
      });

      if (!user) {
        throw new BadRequestError('User not found', ErrorCodes.RESOURCE_NOT_FOUND);
      }

      // Parse natural language time (basic implementation)
      const scheduledTime = this.parseNaturalLanguageTime(naturalLanguageTime, user.timezone);
      
      if (!scheduledTime) {
        logger.warn('Could not parse natural language time', {
          input: naturalLanguageTime,
          userId
        });
        return null;
      }

      return await this.createReminder({
        userId,
        memoryId,
        scheduledFor: scheduledTime,
        message,
        timezone: user.timezone
      });

    } catch (error) {
      logger.error('Failed to parse and create reminder', {
        error: error instanceof Error ? error.message : 'Unknown error',
        naturalLanguageTime,
        userId,
        memoryId
      });
      return null;
    }
  }

  /**
   * Parse natural language time expressions (basic implementation)
   * In production, you'd want to use a more sophisticated NLP library
   */
  private parseNaturalLanguageTime(timeExpression: string, userTimezone: string): Date | null {
    const now = new Date();
    const lowerExpression = timeExpression.toLowerCase();

    try {
      // Handle relative times
      if (lowerExpression.includes('tomorrow')) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Extract time if specified (e.g., "tomorrow at 2 PM")
        const timeMatch = lowerExpression.match(/at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
        if (timeMatch) {
          let hour = parseInt(timeMatch[1] || '0');
          const minute = parseInt(timeMatch[2] || '0');
          const period = timeMatch[3];
          
          if (period === 'pm' && hour !== 12) hour += 12;
          if (period === 'am' && hour === 12) hour = 0;
          
          tomorrow.setHours(hour, minute, 0, 0);
        } else {
          tomorrow.setHours(9, 0, 0, 0); // Default to 9 AM
        }
        
        return tomorrow;
      }

      // Handle "in X hours/minutes"
      const hoursMatch = lowerExpression.match(/in (\d+) hours?/);
      if (hoursMatch) {
        const hours = parseInt(hoursMatch[1] || '0');
        const futureTime = new Date(now.getTime() + (hours * 60 * 60 * 1000));
        return futureTime;
      }

      const minutesMatch = lowerExpression.match(/in (\d+) minutes?/);
      if (minutesMatch) {
        const minutes = parseInt(minutesMatch[1] || '0');
        const futureTime = new Date(now.getTime() + (minutes * 60 * 1000));
        return futureTime;
      }

      // Handle "next week"
      if (lowerExpression.includes('next week')) {
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + 7);
        nextWeek.setHours(9, 0, 0, 0); // Default to 9 AM
        return nextWeek;
      }

      // Handle specific times today (e.g., "at 3 PM")
      const todayTimeMatch = lowerExpression.match(/(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
      if (todayTimeMatch) {
        const today = new Date(now);
        let hour = parseInt(todayTimeMatch[1] || '0');
        const minute = parseInt(todayTimeMatch[2] || '0');
        const period = todayTimeMatch[3];
        
        if (period === 'pm' && hour !== 12) hour += 12;
        if (period === 'am' && hour === 12) hour = 0;
        
        today.setHours(hour, minute, 0, 0);
        
        // If time has passed today, schedule for tomorrow
        if (today <= now) {
          today.setDate(today.getDate() + 1);
        }
        
        return today;
      }

      return null;
    } catch (error) {
      logger.error('Error parsing natural language time', {
        timeExpression,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get reminder statistics
   */
  async getReminderStats(userId?: string): Promise<{
    total: number;
    pending: number;
    sent: number;
    cancelled: number;
    upcomingToday: number;
  }> {
    try {
      const db = getDatabase();
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const whereCondition = userId ? { userId } : {};

      const [total, pending, sent, cancelled, upcomingToday] = await Promise.all([
        db.reminder.count({ where: whereCondition }),
        db.reminder.count({ where: { ...whereCondition, status: 'PENDING' } }),
        db.reminder.count({ where: { ...whereCondition, status: 'SENT' } }),
        db.reminder.count({ where: { ...whereCondition, status: 'CANCELLED' } }),
        db.reminder.count({ 
          where: { 
            ...whereCondition, 
            status: 'PENDING',
            scheduledFor: {
              gte: today,
              lt: tomorrow
            }
          } 
        })
      ]);

      return {
        total,
        pending,
        sent,
        cancelled,
        upcomingToday
      };
    } catch (error) {
      logger.error('Failed to get reminder stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      return {
        total: 0,
        pending: 0,
        sent: 0,
        cancelled: 0,
        upcomingToday: 0
      };
    }
  }

  /**
   * Health check for reminder service
   */
  async healthCheck(): Promise<{ status: string; details: any }> {
    try {
      const stats = await this.getReminderStats();
      
      return {
        status: 'healthy',
        details: {
          jobRunning: !!this.reminderJob,
          jobScheduled: this.reminderJob ? 'scheduled' : 'not_scheduled',
          stats,
          lastProcessedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Stop the reminder service (for graceful shutdown)
   */
  stop(): void {
    if (this.reminderJob) {
      this.reminderJob.stop();
      this.reminderJob = null;
      logger.info('Reminder service stopped');
    }
  }
}

// Export singleton instance
export const reminderService = ReminderService.getInstance();

// Export function for backwards compatibility
export function getReminderService(): ReminderService {
  return reminderService;
}
