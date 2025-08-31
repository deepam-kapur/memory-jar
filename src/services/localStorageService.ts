import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { env } from '../config/environment';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export interface StoredFile {
  id: string;
  originalName: string;
  fileName: string;
  filePath: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  fingerprint: string;
  metadata?: Record<string, any>;
}

export class LocalStorageService {
  private storageDir: string;
  private baseUrl: string;

  constructor() {
    this.storageDir = path.join(process.cwd(), 'storage', 'media');
    this.baseUrl = `${env.HOST}:${env.PORT}/media`;
    
    // Ensure storage directory exists
    this.ensureStorageDir();
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      logger.info('Local storage directory ensured', { storageDir: this.storageDir });
    } catch (error) {
      logger.error('Error creating storage directory', { error });
      throw new BadRequestError(
        'Failed to create storage directory',
        ErrorCodes.FILE_UPLOAD_ERROR
      );
    }
  }

  /**
   * Generate SHA-256 fingerprint for file content
   */
  async generateFingerprint(buffer: Buffer): Promise<string> {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Store file from buffer
   */
  async storeFile(
    buffer: Buffer,
    originalName: string,
    fileType: string,
    metadata?: Record<string, any>
  ): Promise<StoredFile> {
    try {
      // Generate fingerprint
      const fingerprint = await this.generateFingerprint(buffer);
      
      // Generate unique filename
      const fileExtension = path.extname(originalName) || this.getExtensionFromMimeType(fileType);
      const fileName = `${fingerprint}${fileExtension}`;
      const filePath = path.join(this.storageDir, fileName);
      
      // Check if file already exists (deduplication)
      try {
        await fs.access(filePath);
        logger.info('File already exists, using existing file', { 
          fileName, 
          fingerprint,
          originalName 
        });
      } catch {
        // File doesn't exist, write it
        await fs.writeFile(filePath, buffer);
        logger.info('File stored successfully', { 
          fileName, 
          fileSize: buffer.length,
          fingerprint 
        });
      }

      // Generate file URL
      const fileUrl = `${this.baseUrl}/${fileName}`;

      return {
        id: fingerprint,
        originalName,
        fileName,
        filePath,
        fileUrl,
        fileType,
        fileSize: buffer.length,
        fingerprint,
        metadata,
      };
    } catch (error) {
      logger.error('Error storing file', {
        error: error instanceof Error ? error.message : 'Unknown error',
        originalName,
        fileType,
        fileSize: buffer.length,
      });
      throw new BadRequestError(
        `Failed to store file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.FILE_UPLOAD_ERROR
      );
    }
  }

  /**
   * Store file from URL (download and store)
   */
  async storeFileFromUrl(
    url: string,
    originalName: string,
    fileType: string,
    metadata?: Record<string, any>
  ): Promise<StoredFile> {
    try {
      logger.debug('Downloading file from URL', { url, originalName });

      // Download file
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      
      // Store the downloaded file
      return await this.storeFile(buffer, originalName, fileType, metadata);
    } catch (error) {
      logger.error('Error storing file from URL', {
        error: error instanceof Error ? error.message : 'Unknown error',
        url,
        originalName,
      });
      throw new BadRequestError(
        `Failed to store file from URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.FILE_UPLOAD_ERROR
      );
    }
  }

  /**
   * Get file by fingerprint
   */
  async getFileByFingerprint(fingerprint: string): Promise<StoredFile | null> {
    try {
      // Look for files with this fingerprint
      const files = await fs.readdir(this.storageDir);
      const matchingFile = files.find(file => file.startsWith(fingerprint));
      
      if (!matchingFile) {
        return null;
      }

      const filePath = path.join(this.storageDir, matchingFile);
      const stats = await fs.stat(filePath);
      
      return {
        id: fingerprint,
        originalName: matchingFile,
        fileName: matchingFile,
        filePath,
        fileUrl: `${this.baseUrl}/${matchingFile}`,
        fileType: this.getMimeTypeFromExtension(path.extname(matchingFile)),
        fileSize: stats.size,
        fingerprint,
      };
    } catch (error) {
      logger.error('Error getting file by fingerprint', {
        error: error instanceof Error ? error.message : 'Unknown error',
        fingerprint,
      });
      return null;
    }
  }

  /**
   * Delete file by fingerprint
   */
  async deleteFile(fingerprint: string): Promise<boolean> {
    try {
      const file = await this.getFileByFingerprint(fingerprint);
      if (!file) {
        return false;
      }

      await fs.unlink(file.filePath);
      logger.info('File deleted successfully', { fingerprint, fileName: file.fileName });
      return true;
    } catch (error) {
      logger.error('Error deleting file', {
        error: error instanceof Error ? error.message : 'Unknown error',
        fingerprint,
      });
      return false;
    }
  }

  /**
   * Get file stats
   */
  async getFileStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    fileTypes: Record<string, { count: number; size: number }>;
  }> {
    try {
      const files = await fs.readdir(this.storageDir);
      let totalSize = 0;
      const fileTypes: Record<string, { count: number; size: number }> = {};

      for (const file of files) {
        const filePath = path.join(this.storageDir, file);
        const stats = await fs.stat(filePath);
        const fileType = this.getMimeTypeFromExtension(path.extname(file));
        
        totalSize += stats.size;
        
        if (!fileTypes[fileType]) {
          fileTypes[fileType] = { count: 0, size: 0 };
        }
        fileTypes[fileType].count++;
        fileTypes[fileType].size += stats.size;
      }

      return {
        totalFiles: files.length,
        totalSize,
        fileTypes,
      };
    } catch (error) {
      logger.error('Error getting file stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        totalFiles: 0,
        totalSize: 0,
        fileTypes: {},
      };
    }
  }

  /**
   * Get file path by filename
   */
  async getFilePath(filename: string): Promise<string | null> {
    try {
      const filePath = path.join(this.storageDir, filename);
      
      // Check if file exists
      await fs.access(filePath);
      
      return filePath;
    } catch {
      // File doesn't exist
      return null;
    }
  }

  /**
   * Get extension from MIME type
   */
  private getExtensionFromMimeType(mimeType: string): string {
    const extensions: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/avi': '.avi',
      'video/mov': '.mov',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
    };
    
    return extensions[mimeType] || '.bin';
  }

  /**
   * Get MIME type from extension
   */
  private getMimeTypeFromExtension(extension: string): string {
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
    
    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }

  /**
   * Health check for local storage
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; message: string }> {
    try {
      await this.ensureStorageDir();
      const stats = await this.getFileStats();
      
      return {
        status: 'healthy',
        message: `Local storage is operational. ${stats.totalFiles} files, ${Math.round(stats.totalSize / 1024 / 1024)}MB total`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Local storage error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}

// Export singleton instance
let localStorageServiceInstance: LocalStorageService | null = null;

export const getLocalStorageService = (): LocalStorageService => {
  if (!localStorageServiceInstance) {
    localStorageServiceInstance = new LocalStorageService();
  }
  return localStorageServiceInstance;
};
