import { Router } from 'express';
import { validate, validateTwilioSignature } from '../middleware/validation';
import { whatsAppWebhookSchema } from '../validation/schemas';
import { handleIncomingMessage } from '../controllers/webhookController';
import { webhookLimiter, userApiLimiter } from '../middleware/rateLimit';

const router = Router();

/**
 * POST /webhook
 * Handle incoming Twilio WhatsApp messages
 */
router.post('/', 
  webhookLimiter,
  userApiLimiter,
  validateTwilioSignature, // Add Twilio signature validation
  validate(whatsAppWebhookSchema),
  handleIncomingMessage
);

export default router;
