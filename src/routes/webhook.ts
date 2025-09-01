import { Router } from 'express';
import express from 'express';
import { validate, createTwilioSignatureValidator } from '../middleware/validation';
import { whatsAppWebhookSchema } from '../validation/schemas';
import { handleIncomingMessage } from '../controllers/webhookController';
import { webhookLimiter, userApiLimiter } from '../middleware/rateLimit';

const router = Router();

// Create configurable Twilio signature validator
// Configuration is controlled by environment variables:
// - TWILIO_SIGNATURE_VALIDATION_ENABLED=true/false
// - TWILIO_SIGNATURE_DEBUG=true/false
// Or you can override here by uncommenting and setting values
const twilioSignatureValidator = createTwilioSignatureValidator({
  // enabled: false,     // Uncomment to override environment variable
  // debug: true,        // Uncomment to override environment variable
  // skipInDevelopment: true  // Uncomment to skip validation in development
});

/**
 * POST /webhook
 * Handle incoming Twilio WhatsApp messages
 */
router.post('/', 
  webhookLimiter,
  userApiLimiter,
  // First, capture raw body for signature validation
  express.raw({ type: 'application/x-www-form-urlencoded' }),
  (req, _res, next) => {
    // Store raw body for signature validation
    (req as any).rawBody = req.body.toString();
    
    // Parse the body manually for further processing
    const bodyString = req.body.toString();
    const urlParams = new URLSearchParams(bodyString);
    const parsedBody: any = {};
    
    // Convert URLSearchParams to object
    for (const [key, value] of urlParams.entries()) {
      parsedBody[key] = value;
    }
    
    // Replace the buffer with parsed object
    req.body = parsedBody;
    next();
  },
  twilioSignatureValidator, // Configurable Twilio signature validation
  // Note: No need for express.urlencoded() here since we manually parsed above
  validate(whatsAppWebhookSchema),
  handleIncomingMessage
);

/**
 * GET /webhook/validation-status
 * Check current validation configuration
 */
router.get('/validation-status', (_req, res) => {
  res.json({
    validation: {
      enabled: process.env['TWILIO_SIGNATURE_VALIDATION_ENABLED'] !== 'false',
      debug: process.env['TWILIO_SIGNATURE_DEBUG'] === 'true',
      environment: process.env['NODE_ENV']
    },
    message: 'Use POST /webhook/test-validation to test signature validation'
  });
});

/**
 * POST /webhook/test-validation
 * Test endpoint with disabled validation for debugging
 */
router.post('/test-validation',
  webhookLimiter,
  userApiLimiter,
  // Create a test validator with different settings
  createTwilioSignatureValidator({
    enabled: false,  // Disabled for testing
    debug: true      // Always show debug info
  }),
  express.urlencoded({ extended: true }),
  (req, res) => {
    res.json({
      message: 'Test endpoint - validation disabled',
      body: req.body,
      headers: {
        'x-twilio-signature': req.headers['x-twilio-signature'],
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent']
      }
    });
  }
);

export default router;
