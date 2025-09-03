import { Router } from 'express';
import { ReminderController } from '../controllers/reminderController';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

// Validation schemas
const createReminderSchema = z.object({
  body: z.object({
    userId: z.string().min(1),
    memoryId: z.string().min(1),
    message: z.string().min(1),
    scheduledFor: z.string().datetime().optional(),
    naturalLanguageTime: z.string().optional(),
    timezone: z.string().optional(),
  }).refine(
    (data) => data.scheduledFor || data.naturalLanguageTime,
    {
      message: "Either scheduledFor or naturalLanguageTime must be provided",
    }
  ),
});

const getUserRemindersSchema = z.object({
  query: z.object({
    userId: z.string().min(1),
    status: z.enum(['PENDING', 'SENT', 'CANCELLED']).optional(),
  }),
});

const cancelReminderSchema = z.object({
  params: z.object({
    reminderId: z.string().min(1),
  }),
  body: z.object({
    userId: z.string().min(1),
  }),
});

const reminderStatsSchema = z.object({
  query: z.object({
    userId: z.string().optional(),
  }),
});

const createReminderFromMemorySchema = z.object({
  params: z.object({
    memoryId: z.string().min(1),
  }),
  body: z.object({
    userId: z.string().min(1),
    timeExpression: z.string().min(1),
    customMessage: z.string().optional(),
  }),
});

// Routes
router.post('/', validate(createReminderSchema.shape.body), ReminderController.createReminder);
router.get('/', validate(getUserRemindersSchema.shape.query, 'query'), ReminderController.getUserReminders);
router.delete('/:reminderId', validate(cancelReminderSchema.shape.body), ReminderController.cancelReminder);
router.get('/stats', validate(reminderStatsSchema.shape.query, 'query'), ReminderController.getReminderStats);
router.post('/process', ReminderController.processReminders);

// Create reminder from memory
router.post('/memories/:memoryId', validate(createReminderFromMemorySchema.shape.body), ReminderController.createReminderFromMemory);

export default router;
