import crypto from 'crypto';
import { getDatabase } from './database';
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
   * Store media file with deduplication
   */
  static async storeMedia(
    userId: string,
    buffer: Buffer,
    contentType: string,
    originalName: string,
    interactionId?: string,
    memoryId?: string,
    transcription?: string,
    metadata?: Record<string, any>
  ): Promise<MediaFile> {
    const db = getDatabase();

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
          s3Key: existingMedia.s3Key, // Reference the same S3 key
          s3Url: existingMedia.s3Url, // Reference the same S3 URL
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

    // Generate unique filename and S3 key
    const fileExtension = this.getFileExtension(contentType, originalName);
    const fileName = `${fingerprint.hash.substring(0, 8)}_${Date.now()}.${fileExtension}`;
    const s3Key = `media/${userId}/${fileName}`;
    const s3Url = `https://your-s3-bucket.s3.amazonaws.com/${s3Key}`; // Placeholder

    // TODO: Upload to S3 (will be implemented in Phase 3)
    // await this.uploadToS3(buffer, s3Key, contentType);

    // Store new media file
    const mediaFile = await db.mediaFile.create({
      data: {
        userId,
        interactionId,
        memoryId,
        fileName,
        originalName,
        fileType: contentType,
        fileSize: fingerprint.size,
        s3Key,
        s3Url,
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
    memoryId?: string
  ): Promise<MediaFile> {
    try {
      logger.debug('Downloading media from URL', { mediaUrl, contentType });

      // TODO: Implement actual download logic (will be implemented in Phase 3)
      // For now, create a placeholder buffer
      const buffer = Buffer.from('placeholder media content');
      
      // Store with deduplication
      return await this.storeMedia(
        userId,
        buffer,
        contentType,
        originalName,
        interactionId,
        memoryId
      );

    } catch (error) {
      logger.error('Error downloading and storing media', {
        mediaUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new BadRequestError(
        `Failed to download media: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.FILE_UPLOAD_ERROR
      );
    }
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

    const [totalFiles, uniqueFiles, byType] = await Promise.all([
      db.mediaFile.count(),
      db.mediaFile.count({
        where: {
          metadata: {
            path: ['isReference'],
            equals: false,
          },
        },
      }),
      db.mediaFile.groupBy({
        by: ['fileType'],
        _count: { id: true },
        _sum: { fileSize: true },
      }),
    ]);

    const totalSize = byType.reduce((sum, item) => sum + (item._sum.fileSize || 0), 0);
    const deduplicationRate = totalFiles > 0 ? ((totalFiles - uniqueFiles) / totalFiles) * 100 : 0;

    const byTypeStats: Record<string, number> = {};
    byType.forEach(item => {
      byTypeStats[item.fileType] = item._count.id;
    });

    return {
      totalFiles,
      totalSize,
      uniqueFiles,
      byType: byTypeStats,
      deduplicationRate,
    };
  }
}
