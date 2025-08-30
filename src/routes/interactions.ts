import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { apiLimiter } from '../middleware/rateLimit';
import { InteractionController } from '../controllers/interactionController';
import { paginationSchema } from '../validation/schemas';

const router = Router();

/**
 * GET /interactions/recent?limit=<n>
 * Return recent interactions from DB
 * 
 * Returns the most recent interactions from the database,
 * limited by the specified number. This endpoint reads directly
 * from the DB and provides interaction history.
 */
router.get(
  '/recent',
  apiLimiter,
  validate(paginationSchema, 'query'),
  asyncHandler(InteractionController.getRecentInteractions)
);

export default router;
