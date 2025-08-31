import { Router } from 'express';
import { validate } from '../middleware/validation';
import { whatsAppWebhookSchema } from '../validation/schemas';
import { handleIncomingMessage } from '../controllers/webhookController';
import { webhookLimiter } from '../middleware/rateLimit';

const router = Router();

/**
 * POST /webhook
 * Handle incoming Twilio WhatsApp messages
 */
router.post('/', 
  webhookLimiter,
  validate(whatsAppWebhookSchema),
  handleIncomingMessage
);

export default router;
