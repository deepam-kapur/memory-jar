import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { searchLimiter, apiLimiter } from '../middleware/rateLimit';
import { MemoryController } from '../controllers/memoryController';
import { 
  createMemorySchema, 
  searchMemoriesSchema, 
  paginationSchema 
} from '../validation/schemas';

const router = Router();

/**
 * POST /memories
 * Add multimodal memories (text, image, audio)
 * 
 * Creates a new memory from text, image, or audio content.
 * For images and audio, this endpoint processes the media and
 * creates memories using Mem0 for semantic storage.
 */
router.post(
  '/',
  apiLimiter,
  validate(createMemorySchema, 'body'),
  asyncHandler(MemoryController.createMemory)
);

/**
 * GET /memories?query=<text>
 * Search memories via Mem0 and enrich responses with DB
 * 
 * Performs semantic search using Mem0 and returns enriched
 * results with database metadata (timestamps, tags, etc.)
 */
router.get(
  '/',
  searchLimiter,
  validate(searchMemoriesSchema, 'query'),
  asyncHandler(MemoryController.searchMemories)
);

/**
 * GET /memories/list
 * Return all memories from DB (newest first)
 * 
 * Returns all memories from the database, ordered by creation
 * date (newest first). This endpoint reads directly from the DB,
 * not from Mem0.
 */
router.get(
  '/list',
  apiLimiter,
  validate(paginationSchema, 'query'),
  asyncHandler(MemoryController.listAllMemories)
);

export default router;
