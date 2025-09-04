import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { webhookLimiter } from '../middleware/rateLimit';
import { WebhookController } from '../controllers/webhookController';
import { whatsAppWebhookSchema } from '../validation/schemas';
import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';

const router = Router();

// Temporary bypass for signature validation during development
const bypassSignatureValidation = (req: Request, res: Response, next: NextFunction) => {
  logger.info('Bypassing Twilio signature validation for development', {
    'X-Twilio-Signature': req.get('X-Twilio-Signature'),
    origin: req.get('origin'),
    userAgent: req.get('user-agent')
  });
  next();
};

/**
 * POST /webhook
 * Handle incoming Twilio WhatsApp messages
 * 
 * This endpoint receives webhooks from Twilio when users send messages
 * to the WhatsApp bot. It processes text, image, and audio messages.
 */
router.post(
  '/',
  bypassSignatureValidation,
  webhookLimiter,
  validate(whatsAppWebhookSchema, 'body'),
  asyncHandler(WebhookController.handleIncomingMessage)
);



export default router;
