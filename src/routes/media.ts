import { Router } from 'express';
import { getLocalStorageService } from '../services/localStorageService';
import { NotFoundError, ErrorCodes } from '../utils/errors';
import logger from '../config/logger';

const router = Router();

/**
 * GET /media/:filename
 * Serve media files from local storage
 */
router.get('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    if (!filename) {
      throw new NotFoundError('Filename is required', ErrorCodes.RESOURCE_NOT_FOUND);
    }

    const localStorageService = getLocalStorageService();
    const filePath = await localStorageService.getFilePath(filename);

    if (!filePath) {
      throw new NotFoundError('File not found', ErrorCodes.RESOURCE_NOT_FOUND);
    }

    logger.info('Serving media file', {
      filename,
      filePath,
      requestId: req.id,
    });

    // Send the file
    return res.sendFile(filePath);
  } catch (error) {
    logger.error('Error serving media file', {
      filename: req.params.filename,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
});

export default router;
