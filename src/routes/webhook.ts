import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { webhookLimiter } from '../middleware/rateLimit';
import { WebhookController } from '../controllers/webhookController';
import { whatsAppWebhookSchema } from '../validation/schemas';

const router = Router();

/**
 * POST /webhook
 * Handle incoming Twilio WhatsApp messages
 * 
 * This endpoint receives webhooks from Twilio when users send messages
 * to the WhatsApp bot. It processes text, image, and audio messages.
 */
router.post(
  '/',
  webhookLimiter,
  validate(whatsAppWebhookSchema, 'body'),
  asyncHandler(WebhookController.handleIncomingMessage)
);



export default router;
