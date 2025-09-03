import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { apiLimiter } from '../middleware/rateLimit';
import { MemorySharingController } from '../controllers/memorySharingController';
import { 
  shareMemorySchema,
  acceptShareSchema,
  rejectShareSchema,
  respondToShareSchema,
  getUserSharesSchema 
} from '../validation/schemas';

const router = Router();

/**
 * POST /sharing/share
 * Share a memory with another user by phone number
 * 
 * Creates a new memory share and sends a WhatsApp notification
 * to the recipient with options to accept or reject.
 */
router.post(
  '/share',
  apiLimiter,
  validate(shareMemorySchema, 'body'),
  asyncHandler(MemorySharingController.shareMemory)
);

/**
 * POST /sharing/:shareId/accept
 * Accept a shared memory
 * 
 * Accepts a memory share and optionally copies it to the 
 * recipient's memory collection.
 */
router.post(
  '/:shareId/accept',
  apiLimiter,
  validate(acceptShareSchema, 'body'),
  asyncHandler(MemorySharingController.acceptShare)
);

/**
 * POST /sharing/:shareId/reject
 * Reject a shared memory
 * 
 * Rejects a memory share and notifies the original sender.
 */
router.post(
  '/:shareId/reject',
  apiLimiter,
  validate(rejectShareSchema, 'body'),
  asyncHandler(MemorySharingController.rejectShare)
);

/**
 * POST /sharing/respond
 * Respond to a share with WhatsApp-style commands
 * 
 * Handles accept/reject responses via simple action commands,
 * useful for WhatsApp integration.
 */
router.post(
  '/respond',
  apiLimiter,
  validate(respondToShareSchema, 'body'),
  asyncHandler(MemorySharingController.respondToShare)
);

/**
 * GET /sharing/shares
 * Get user's memory shares (sent and received)
 * 
 * Returns all memory shares for a user with optional filtering
 * by type (sent/received) and status.
 */
router.get(
  '/shares',
  apiLimiter,
  validate(getUserSharesSchema, 'query'),
  asyncHandler(MemorySharingController.getUserShares)
);

/**
 * GET /sharing/pending
 * Get pending memory shares for a user
 * 
 * Returns all pending memory shares that require a response
 * from the specified user.
 */
router.get(
  '/pending',
  apiLimiter,
  validate(getUserSharesSchema, 'query'),
  asyncHandler(MemorySharingController.getPendingShares)
);

/**
 * GET /sharing/stats
 * Get memory sharing statistics
 * 
 * Returns comprehensive statistics about memory sharing
 * activity, acceptance rates, and usage patterns.
 */
router.get(
  '/stats',
  apiLimiter,
  asyncHandler(MemorySharingController.getSharingStats)
);

/**
 * GET /sharing/health
 * Memory sharing service health check
 * 
 * Returns the health status of the memory sharing service
 * including operational statistics.
 */
router.get(
  '/health',
  apiLimiter,
  asyncHandler(MemorySharingController.getServiceHealth)
);

export default router;
