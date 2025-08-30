import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { apiLimiter } from '../middleware/rateLimit';
import { AnalyticsController } from '../controllers/analyticsController';

const router = Router();

/**
 * GET /analytics/summary
 * Return DB-derived stats
 * 
 * Returns simple database-derived statistics including:
 * - Totals by type (text, image, audio)
 * - Top tags/labels
 * - Last ingest time
 * - Usage patterns and trends
 */
router.get(
  '/summary',
  apiLimiter,
  asyncHandler(AnalyticsController.getAnalyticsSummary)
);

export default router;
