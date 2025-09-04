import crypto from 'crypto';
import fetch from 'node-fetch';
import { getDatabase } from './database';
import { getLocalStorageService } from './localStorageService';
import { getTwilioService } from './twilioService';
import { Prisma } from '../generated/prisma';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export interface MediaFingerprint {
  hash: string;
  size: number;
  contentType: string;
  originalName?: string;
}

export interface MediaFile {
  id: string;
  userId: string;
  interactionId: string | null;
  memoryId: string | null;
  fileName: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  s3Key: string;
  s3Url: string;
  fingerprint: string;
  transcription: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

export class MediaService {
  /**
   * Generate SHA-256 fingerprint for media content
   */
  static generateFingerprint(buffer: Buffer, contentType: string, originalName?: string): MediaFingerprint {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const size = buffer.length;

    logger.debug('Generated media fingerprint', {
      hash: hash.substring(0, 8) + '...',
      size,
      contentType,
      originalName,
    });

    return {
      hash,
      size,
      contentType,
      originalName,
    };
  }

  /**
   * Check if media file already exists (deduplication)
   */
  static async findExistingMedia(fingerprint: string): Promise<MediaFile | null> {
    const db = getDatabase();

    const existingMedia = await db.mediaFile.findFirst({
      where: {
        fingerprint: fingerprint,
      },
      include: {
        user: {
          select: {
            id: true,
            phoneNumber: true,
            name: true,
          },
        },
        interaction: {
          select: {
            id: true,
            messageType: true,
            content: true,
          },
        },
        memory: {
          select: {
            id: true,
            content: true,
            memoryType: true,
          },
        },
      },
    });

    if (existingMedia) {
      logger.info('Found existing media file (deduplication)', {
        mediaId: existingMedia.id,
        fingerprint: fingerprint.substring(0, 8) + '...',
        originalUploader: existingMedia.userId,
      });
    }

    return existingMedia;
  }

  /**
   * Store media file with deduplication using local storage
   */
  static async storeMedia(
    userId: string,
    buffer: Buffer,
    contentType: string,
    originalName: string,
    interactionId?: string,
    memoryId?: string,
    transcription?: string,
    metadata?: Record<string, unknown>
  ): Promise<MediaFile> {
    const db = getDatabase();
    const localStorageService = getLocalStorageService();

    // Generate fingerprint
    const fingerprint = this.generateFingerprint(buffer, contentType, originalName);

    // Check for existing media (deduplication)
    const existingMedia = await this.findExistingMedia(fingerprint.hash);
    if (existingMedia) {
      // Create a reference to the existing media file
      const mediaReference = await db.mediaFile.create({
        data: {
          userId,
          interactionId,
          memoryId,
          fileName: existingMedia.fileName, // Reference the same file
          originalName,
          fileType: contentType,
          fileSize: existingMedia.fileSize,
          s3Key: existingMedia.s3Key, // Reference the same local path
          s3Url: existingMedia.s3Url, // Reference the same local URL
          fingerprint: fingerprint.hash, // Same fingerprint
          transcription,
          metadata: {
            ...metadata,
            isReference: true,
            originalMediaId: existingMedia.id,
            originalUploader: existingMedia.userId,
            originalUploadDate: existingMedia.createdAt,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
          interaction: {
            select: {
              id: true,
              messageType: true,
              content: true,
            },
          },
          memory: {
            select: {
              id: true,
              content: true,
              memoryType: true,
            },
          },
        },
      });

      logger.info('Created media reference (deduplication)', {
        mediaId: mediaReference.id,
        originalMediaId: existingMedia.id,
        fingerprint: fingerprint.hash.substring(0, 8) + '...',
      });

      return mediaReference;
    }

    // Store file using local storage
    const storedFile = await localStorageService.storeFile(
      buffer,
      originalName,
      contentType,
      metadata
    );

    // Store new media file
    const mediaFile = await db.mediaFile.create({
      data: {
        userId,
        interactionId,
        memoryId,
        fileName: storedFile.fileName,
        originalName,
        fileType: contentType,
        fileSize: fingerprint.size,
        s3Key: storedFile.filePath, // Use local file path instead of S3 key
        s3Url: storedFile.fileUrl, // Use local file URL instead of S3 URL
        fingerprint: fingerprint.hash,
        transcription,
        metadata: {
          ...metadata,
          isReference: false,
          uploadDate: new Date().toISOString(),
        },
      },
      include: {
        user: {
          select: {
            id: true,
            phoneNumber: true,
            name: true,
          },
        },
        interaction: {
          select: {
            id: true,
            messageType: true,
            content: true,
          },
        },
        memory: {
          select: {
            id: true,
            content: true,
            memoryType: true,
          },
        },
      },
    });

    logger.info('Stored new media file', {
      mediaId: mediaFile.id,
      fingerprint: fingerprint.hash.substring(0, 8) + '...',
      size: fingerprint.size,
      contentType,
    });

    return mediaFile;
  }

  /**
   * Get file extension from content type or original name
   */
  private static getFileExtension(contentType: string, originalName?: string): string {
    // Try to get extension from original name first
    if (originalName && originalName.includes('.')) {
      const extension = originalName.split('.').pop()?.toLowerCase();
      if (extension && extension.length <= 5) {
        return extension;
      }
    }

    // Fall back to content type mapping
    const contentTypeMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/ogg': 'ogg',
      'video/mp4': 'mp4',
      'video/avi': 'avi',
      'video/mov': 'mov',
      'application/pdf': 'pdf',
      'text/plain': 'txt',
    };

    return contentTypeMap[contentType] || 'bin';
  }

  /**
   * Download media from URL and store with deduplication
   */
  static async downloadAndStoreMedia(
    userId: string,
    mediaUrl: string,
    contentType: string,
    originalName: string,
    interactionId?: string,
    memoryId?: string,
    transcription?: string,
    metadata?: Record<string, unknown>
  ): Promise<MediaFile> {
    try {
      logger.info('Starting media download and storage', { 
        mediaUrl: mediaUrl.substring(0, 50) + '...', 
        contentType, 
        originalName 
      });

      // Download media using appropriate service based on URL
      let buffer: Buffer;
      
      if (mediaUrl.includes('twilio.com') || mediaUrl.includes('api.twilio.com')) {
        // Use Twilio service for Twilio media URLs
        const twilioService = getTwilioService();
        buffer = await twilioService.downloadMedia(mediaUrl);
        logger.debug('Media downloaded via Twilio service', { 
          size: buffer.length,
          contentType 
        });
      } else {
        // Use standard HTTP fetch for other URLs
        buffer = await this.downloadFromUrl(mediaUrl);
        logger.debug('Media downloaded via HTTP fetch', { 
          size: buffer.length,
          contentType 
        });
      }

      // Validate downloaded content
      if (buffer.length === 0) {
        throw new Error('Downloaded file is empty');
      }

      // Verify content type if possible
      const detectedContentType = this.detectContentType(buffer, contentType);
      const finalContentType = detectedContentType || contentType;

      logger.info('Media download completed successfully', {
        originalUrl: mediaUrl.substring(0, 50) + '...',
        downloadSize: buffer.length,
        originalContentType: contentType,
        detectedContentType: finalContentType,
        originalName
      });
      
      // Store with deduplication
      return await this.storeMedia(
        userId,
        buffer,
        finalContentType,
        originalName,
        interactionId,
        memoryId,
        transcription,
        {
          ...metadata,
          originalUrl: mediaUrl,
          downloadTimestamp: new Date().toISOString(),
          downloadSize: buffer.length
        }
      );

    } catch (error) {
      logger.error('Error downloading and storing media', {
        mediaUrl: mediaUrl.substring(0, 50) + '...',
        contentType,
        originalName,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw new BadRequestError(
        `Failed to download media: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.FILE_UPLOAD_ERROR
      );
    }
  }

  /**
   * Download media from a standard HTTP URL
   */
  private static async downloadFromUrl(url: string): Promise<Buffer> {
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      logger.error('Error downloading from URL', {
        url: url.substring(0, 50) + '...',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Detect content type from buffer content
   */
  private static detectContentType(buffer: Buffer, fallbackType: string): string {
    if (buffer.length < 4) {
      return fallbackType;
    }

    // Check common file signatures
    const signatures: Record<string, string> = {
      // Images
      'ffd8ff': 'image/jpeg',
      '89504e47': 'image/png',
      '47494638': 'image/gif',
      '52494646': 'image/webp', // Actually RIFF, but WebP uses RIFF
      
      // Audio
      '494433': 'audio/mpeg', // MP3
      'fff1': 'audio/aac', // AAC
      'fff9': 'audio/aac', // AAC
      '4f676753': 'audio/ogg', // OGG
      
      // Video
      '00000020667479704d534e56': 'video/mp4', // MP4
      '1a45dfa3': 'video/webm', // WebM
      
      // Documents
      '25504446': 'application/pdf', // PDF
      'd0cf11e0': 'application/msword', // DOC
    };

    // Convert first few bytes to hex
    const hex = buffer.subarray(0, 12).toString('hex').toLowerCase();
    
    // Check signatures
    for (const [signature, mimeType] of Object.entries(signatures)) {
      if (hex.startsWith(signature)) {
        logger.debug('Content type detected from file signature', {
          signature,
          detectedType: mimeType,
          fallbackType
        });
        return mimeType;
      }
    }

    // Return fallback type if no signature matched
    return fallbackType;
  }

  /**
   * Get media statistics for analytics
   */
  static async getMediaStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    uniqueFiles: number;
    byType: Record<string, number>;
    deduplicationRate: number;
  }> {
    const db = getDatabase();

    const [totalFiles, uniqueFiles, allMediaFiles] = await Promise.all([
      db.mediaFile.count(),
      db.mediaFile.count({
        where: {
          metadata: {
            path: ['isReference'],
            equals: false,
          },
        },
      }),
      db.mediaFile.findMany({
        select: { fileType: true, fileSize: true },
      }),
    ]);

    // Manual grouping by file type
    const byTypeCounts: Record<string, number> = {};
    let totalSize = 0;
    
    allMediaFiles.forEach(media => {
      byTypeCounts[media.fileType] = (byTypeCounts[media.fileType] || 0) + 1;
      totalSize += media.fileSize || 0;
    });

    const deduplicationRate = totalFiles > 0 ? ((totalFiles - uniqueFiles) / totalFiles) * 100 : 0;

    return {
      totalFiles,
      totalSize,
      uniqueFiles,
      byType: byTypeCounts,
      deduplicationRate,
    };
  }
}
