import express from 'express';
import path from 'path';
import { env } from '../config/environment';
import logger from '../config/logger';

const router = express.Router();

// Serve media files from local storage
router.get('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Security: Prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        error: 'Invalid filename',
        message: 'Filename contains invalid characters',
      });
    }

    const mediaPath = path.join(process.cwd(), 'storage', 'media', filename);
    
    // Check if file exists
    try {
      await import('fs/promises').then(fs => fs.access(mediaPath));
    } catch {
      return res.status(404).json({
        error: 'File not found',
        message: 'The requested media file does not exist',
      });
    }

    // Set appropriate headers
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.avi': 'video/avi',
      '.mov': 'video/mov',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

    // Serve the file
    res.sendFile(mediaPath);

    logger.debug('Media file served', {
      filename,
      contentType,
      path: mediaPath,
    });
  } catch (error) {
    logger.error('Error serving media file', {
      error: error instanceof Error ? error.message : 'Unknown error',
      filename: req.params.filename,
    });
    
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to serve media file',
    });
  }
});

export default router;
