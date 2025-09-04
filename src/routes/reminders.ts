import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { apiLimiter } from '../middleware/rateLimit';
import { ReminderController } from '../controllers/reminderController';
import { 
  createReminderSchema,
  cancelReminderSchema,
  getReminderSchema,
  paginationSchema 
} from '../validation/schemas';

const router = Router();

/**
 * POST /reminders
 * Create a scheduled reminder
 * 
 * Creates a new reminder linked to a memory that will be sent 
 * at the specified time via WhatsApp.
 */
router.post(
  '/',
  apiLimiter,
  validate(createReminderSchema, 'body'),
  asyncHandler(ReminderController.createReminder)
);

/**
 * GET /reminders
 * Get user's reminders with optional filtering
 * 
 * Returns reminders for a user with optional status filtering
 * and pagination support.
 */
router.get(
  '/',
  apiLimiter,
  validate(getReminderSchema, 'query'),
  asyncHandler(ReminderController.getUserReminders)
);

/**
 * GET /reminders/stats
 * Get reminder statistics for analytics
 * 
 * Returns comprehensive statistics about reminders including
 * counts by status, upcoming reminders, and success rates.
 */
router.get(
  '/stats',
  apiLimiter,
  asyncHandler(ReminderController.getReminderStats)
);

/**
 * POST /reminders/parse
 * Parse natural language time and create reminder
 * 
 * Accepts natural language time expressions like "tomorrow at 3 PM"
 * and creates a reminder for the specified memory.
 */
router.post(
  '/parse',
  apiLimiter,
  validate(createReminderSchema, 'body'),
  asyncHandler(ReminderController.parseAndCreateReminder)
);

/**
 * PATCH /reminders/:id/cancel
 * Cancel a pending reminder
 * 
 * Cancels a pending reminder, preventing it from being sent.
 * Only works for reminders in PENDING status.
 */
router.patch(
  '/:id/cancel',
  apiLimiter,
  validate(cancelReminderSchema, 'params'),
  asyncHandler(ReminderController.cancelReminder)
);

/**
 * GET /reminders/upcoming
 * Get upcoming reminders (next 24 hours)
 * 
 * Returns reminders scheduled for the next 24 hours,
 * useful for dashboard displays and quick overviews.
 */
router.get(
  '/upcoming',
  apiLimiter,
  validate(paginationSchema, 'query'),
  asyncHandler(ReminderController.getUpcomingReminders)
);

/**
 * GET /reminders/health
 * Health check for reminder service
 * 
 * Returns the health status of the reminder service including
 * background job status and processing statistics.
 */
router.get(
  '/health',
  apiLimiter,
  asyncHandler(ReminderController.getServiceHealth)
);

export default router;