import { getDatabase } from './database';
import { getTwilioService } from './twilioService';
import { getMoodDetectionService } from './moodDetectionService';
import logger from '../config/logger';
import { BadRequestError, NotFoundError, ErrorCodes } from '../utils/errors';

export interface CreateMemoryShareOptions {
  memoryId: string;
  fromUserId: string;
  toPhoneNumber: string;
  message?: string;
}

export interface MemoryShareResponse {
  id: string;
  memoryId: string;
  fromUserId: string;
  toUserId: string;
  message?: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  createdAt: Date;
  respondedAt?: Date;
  memory: {
    id: string;
    content: string;
    memoryType: string;
    createdAt: Date;
  };
  fromUser: {
    id: string;
    phoneNumber: string;
    name?: string;
  };
  toUser: {
    id: string;
    phoneNumber: string;
    name?: string;
  };
}

export interface AcceptMemoryShareOptions {
  shareId: string;
  toUserId: string;
  copyToMyMemories?: boolean;
}

export class MemorySharingService {
  /**
   * Share a memory with another user by phone number
   */
  static async shareMemory(options: CreateMemoryShareOptions): Promise<MemoryShareResponse> {
    try {
      const db = getDatabase();
      const { memoryId, fromUserId, toPhoneNumber, message } = options;

      // Verify the memory exists and belongs to the from user
      const memory = await db.memory.findFirst({
        where: {
          id: memoryId,
          userId: fromUserId,
        },
        include: {
          user: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
        },
      });

      if (!memory) {
        throw new NotFoundError(
          'Memory not found or you do not have permission to share it',
          ErrorCodes.RESOURCE_NOT_FOUND
        );
      }

      // Find or create the target user by phone number
      const cleanPhoneNumber = toPhoneNumber.replace(/\D/g, ''); // Remove non-digits
      let toUser = await db.user.findFirst({
        where: {
          phoneNumber: {
            endsWith: cleanPhoneNumber.slice(-10), // Match last 10 digits
          },
        },
      });

      if (!toUser) {
        // Create a new user record for the phone number
        toUser = await db.user.create({
          data: {
            phoneNumber: cleanPhoneNumber,
            timezone: 'UTC', // Default timezone
          },
        });

        logger.info('Created new user for memory sharing', {
          userId: toUser.id,
          phoneNumber: cleanPhoneNumber,
        });
      }

      // Check if a share already exists between these users for this memory
      const existingShare = await db.sharedMemory.findFirst({
        where: {
          memoryId,
          fromUserId,
          toUserId: toUser.id,
          status: 'PENDING',
        },
      });

      if (existingShare) {
        throw new BadRequestError(
          'Memory is already shared with this user and pending response',
          ErrorCodes.RESOURCE_CONFLICT
        );
      }

      // Create the memory share
      const sharedMemory = await db.sharedMemory.create({
        data: {
          memoryId,
          fromUserId,
          toUserId: toUser.id,
          message: message || undefined,
          status: 'PENDING',
        },
        include: {
          memory: {
            select: {
              id: true,
              content: true,
              memoryType: true,
              createdAt: true,
            },
          },
          fromUser: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
          toUser: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
        },
      });

      // Send WhatsApp notification to the recipient
      await this.sendShareNotification(sharedMemory);

      logger.info('Memory shared successfully', {
        shareId: sharedMemory.id,
        memoryId,
        fromUserId,
        toUserId: toUser.id,
        toPhoneNumber: cleanPhoneNumber,
      });

      return sharedMemory;
    } catch (error) {
      logger.error('Error sharing memory', {
        error: error instanceof Error ? error.message : 'Unknown error',
        options,
      });

      if (error instanceof BadRequestError || error instanceof NotFoundError) {
        throw error;
      }

      throw new BadRequestError(
        `Failed to share memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.INTERNAL_ERROR
      );
    }
  }

  /**
   * Accept a shared memory
   */
  static async acceptMemoryShare(options: AcceptMemoryShareOptions): Promise<MemoryShareResponse> {
    try {
      const db = getDatabase();
      const { shareId, toUserId, copyToMyMemories = true } = options;

      // Find the pending memory share
      const sharedMemory = await db.sharedMemory.findFirst({
        where: {
          id: shareId,
          toUserId,
          status: 'PENDING',
        },
        include: {
          memory: {
            select: {
              id: true,
              content: true,
              memoryType: true,
              tags: true,
              importance: true,
              createdAt: true,
            },
          },
          fromUser: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
          toUser: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
        },
      });

      if (!sharedMemory) {
        throw new NotFoundError(
          'Shared memory not found or already responded to',
          ErrorCodes.RESOURCE_NOT_FOUND
        );
      }

      // Update the share status
      const updatedShare = await db.sharedMemory.update({
        where: { id: shareId },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date(),
        },
        include: {
          memory: {
            select: {
              id: true,
              content: true,
              memoryType: true,
              createdAt: true,
            },
          },
          fromUser: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
          toUser: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
        },
      });

      // Optionally copy the memory to the recipient's memories
      if (copyToMyMemories) {
        await this.copySharedMemoryToUser(sharedMemory, toUserId);
      }

      // Notify the original sharer
      await this.sendAcceptanceNotification(updatedShare);

      logger.info('Memory share accepted', {
        shareId,
        toUserId,
        copiedToMemories: copyToMyMemories,
      });

      return updatedShare;
    } catch (error) {
      logger.error('Error accepting memory share', {
        error: error instanceof Error ? error.message : 'Unknown error',
        options,
      });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new BadRequestError(
        `Failed to accept memory share: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.INTERNAL_ERROR
      );
    }
  }

  /**
   * Reject a shared memory
   */
  static async rejectMemoryShare(shareId: string, toUserId: string): Promise<MemoryShareResponse> {
    try {
      const db = getDatabase();

      // Find the pending memory share
      const sharedMemory = await db.sharedMemory.findFirst({
        where: {
          id: shareId,
          toUserId,
          status: 'PENDING',
        },
      });

      if (!sharedMemory) {
        throw new NotFoundError(
          'Shared memory not found or already responded to',
          ErrorCodes.RESOURCE_NOT_FOUND
        );
      }

      // Update the share status
      const updatedShare = await db.sharedMemory.update({
        where: { id: shareId },
        data: {
          status: 'REJECTED',
          respondedAt: new Date(),
        },
        include: {
          memory: {
            select: {
              id: true,
              content: true,
              memoryType: true,
              createdAt: true,
            },
          },
          fromUser: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
          toUser: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
        },
      });

      // Notify the original sharer
      await this.sendRejectionNotification(updatedShare);

      logger.info('Memory share rejected', {
        shareId,
        toUserId,
      });

      return updatedShare;
    } catch (error) {
      logger.error('Error rejecting memory share', {
        error: error instanceof Error ? error.message : 'Unknown error',
        shareId,
        toUserId,
      });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new BadRequestError(
        `Failed to reject memory share: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ErrorCodes.INTERNAL_ERROR
      );
    }
  }

  /**
   * Get memory shares for a user (sent and received)
   */
  static async getUserMemoryShares(
    userId: string,
    type: 'sent' | 'received' | 'all' = 'all',
    status?: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  ): Promise<MemoryShareResponse[]> {
    try {
      const db = getDatabase();

      const whereConditions: any = {};

      if (type === 'sent') {
        whereConditions.fromUserId = userId;
      } else if (type === 'received') {
        whereConditions.toUserId = userId;
      } else {
        whereConditions.OR = [
          { fromUserId: userId },
          { toUserId: userId },
        ];
      }

      if (status) {
        whereConditions.status = status;
      }

      const shares = await db.sharedMemory.findMany({
        where: whereConditions,
        include: {
          memory: {
            select: {
              id: true,
              content: true,
              memoryType: true,
              createdAt: true,
            },
          },
          fromUser: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
          toUser: {
            select: {
              id: true,
              phoneNumber: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      logger.info('Retrieved memory shares for user', {
        userId,
        type,
        status,
        count: shares.length,
      });

      return shares;
    } catch (error) {
      logger.error('Error getting user memory shares', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        type,
        status,
      });
      return [];
    }
  }

  /**
   * Send WhatsApp notification about a shared memory
   */
  private static async sendShareNotification(sharedMemory: MemoryShareResponse): Promise<void> {
    try {
      const twilioService = getTwilioService();

      const senderName = sharedMemory.fromUser.name || 
        sharedMemory.fromUser.phoneNumber.slice(-4); // Last 4 digits as fallback

      const memoryPreview = sharedMemory.memory.content.length > 100
        ? sharedMemory.memory.content.substring(0, 100) + '...'
        : sharedMemory.memory.content;

      const memoryTypeEmoji = this.getMemoryTypeEmoji(sharedMemory.memory.memoryType);

      let message = `🤝 *Shared Memory*\n\n`;
      message += `👤 *From:* ${senderName}\n`;
      message += `${memoryTypeEmoji} *Memory:*\n"${memoryPreview}"\n\n`;

      if (sharedMemory.message) {
        message += `💬 *Note:* ${sharedMemory.message}\n\n`;
      }

      message += `✅ Reply "accept" to add to your memories\n`;
      message += `❌ Reply "reject" to decline\n\n`;
      message += `📱 _Share ID: ${sharedMemory.id.slice(-8)}_`;

      await twilioService.sendWhatsAppMessage(
        sharedMemory.toUser.phoneNumber,
        message
      );

      logger.info('Share notification sent via WhatsApp', {
        shareId: sharedMemory.id,
        toPhone: sharedMemory.toUser.phoneNumber,
      });
    } catch (error) {
      logger.error('Failed to send share notification', {
        shareId: sharedMemory.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw error to prevent share creation failure
    }
  }

  /**
   * Send acceptance notification to the original sharer
   */
  private static async sendAcceptanceNotification(sharedMemory: MemoryShareResponse): Promise<void> {
    try {
      const twilioService = getTwilioService();

      const recipientName = sharedMemory.toUser.name || 
        sharedMemory.toUser.phoneNumber.slice(-4);

      const memoryPreview = sharedMemory.memory.content.length > 60
        ? sharedMemory.memory.content.substring(0, 60) + '...'
        : sharedMemory.memory.content;

      let message = `✅ *Memory Share Accepted*\n\n`;
      message += `👤 *${recipientName}* accepted your shared memory:\n\n`;
      message += `"${memoryPreview}"\n\n`;
      message += `🎉 Your memory is now part of their collection!`;

      await twilioService.sendWhatsAppMessage(
        sharedMemory.fromUser.phoneNumber,
        message
      );

      logger.info('Acceptance notification sent via WhatsApp', {
        shareId: sharedMemory.id,
        toPhone: sharedMemory.fromUser.phoneNumber,
      });
    } catch (error) {
      logger.error('Failed to send acceptance notification', {
        shareId: sharedMemory.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send rejection notification to the original sharer
   */
  private static async sendRejectionNotification(sharedMemory: MemoryShareResponse): Promise<void> {
    try {
      const twilioService = getTwilioService();

      const recipientName = sharedMemory.toUser.name || 
        sharedMemory.toUser.phoneNumber.slice(-4);

      const memoryPreview = sharedMemory.memory.content.length > 60
        ? sharedMemory.memory.content.substring(0, 60) + '...'
        : sharedMemory.memory.content;

      let message = `❌ *Memory Share Declined*\n\n`;
      message += `👤 *${recipientName}* declined your shared memory:\n\n`;
      message += `"${memoryPreview}"\n\n`;
      message += `💭 No worries - your memory is still safe in your collection.`;

      await twilioService.sendWhatsAppMessage(
        sharedMemory.fromUser.phoneNumber,
        message
      );

      logger.info('Rejection notification sent via WhatsApp', {
        shareId: sharedMemory.id,
        toPhone: sharedMemory.fromUser.phoneNumber,
      });
    } catch (error) {
      logger.error('Failed to send rejection notification', {
        shareId: sharedMemory.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Copy shared memory to the recipient's memory collection
   */
  private static async copySharedMemoryToUser(
    sharedMemory: any,
    toUserId: string
  ): Promise<void> {
    try {
      const db = getDatabase();

      // Create a copy of the memory for the recipient
      await db.memory.create({
        data: {
          userId: toUserId,
          content: `[Shared] ${sharedMemory.memory.content}`,
          memoryType: sharedMemory.memory.memoryType,
          tags: [
            ...(Array.isArray(sharedMemory.memory.tags) ? sharedMemory.memory.tags : []),
            'shared_memory',
            `shared_from_${sharedMemory.fromUser.phoneNumber.slice(-4)}`,
          ],
          importance: sharedMemory.memory.importance || 1,
        },
      });

      logger.info('Shared memory copied to recipient', {
        originalMemoryId: sharedMemory.memory.id,
        toUserId,
        shareId: sharedMemory.id,
      });
    } catch (error) {
      logger.error('Failed to copy shared memory to user', {
        shareId: sharedMemory.id,
        toUserId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw error to prevent acceptance failure
    }
  }

  /**
   * Get emoji for memory type
   */
  private static getMemoryTypeEmoji(memoryType: string): string {
    const emojiMap: Record<string, string> = {
      'TEXT': '📝',
      'IMAGE': '🖼️',
      'AUDIO': '🎵',
      'VIDEO': '🎬',
      'MIXED': '📎',
    };
    return emojiMap[memoryType] || '📝';
  }

  /**
   * Get memory sharing statistics
   */
  static async getSharingStats(userId?: string): Promise<{
    totalShares: number;
    sentShares: number;
    receivedShares: number;
    acceptedShares: number;
    pendingShares: number;
    rejectedShares: number;
    acceptanceRate: number;
  }> {
    try {
      const db = getDatabase();

      const whereCondition = userId 
        ? { OR: [{ fromUserId: userId }, { toUserId: userId }] }
        : {};

      const [
        totalShares,
        sentShares,
        receivedShares,
        acceptedShares,
        pendingShares,
        rejectedShares,
      ] = await Promise.all([
        db.sharedMemory.count({ where: whereCondition }),
        db.sharedMemory.count({ 
          where: userId ? { fromUserId: userId } : {}
        }),
        db.sharedMemory.count({ 
          where: userId ? { toUserId: userId } : {}
        }),
        db.sharedMemory.count({ 
          where: { ...whereCondition, status: 'ACCEPTED' }
        }),
        db.sharedMemory.count({ 
          where: { ...whereCondition, status: 'PENDING' }
        }),
        db.sharedMemory.count({ 
          where: { ...whereCondition, status: 'REJECTED' }
        }),
      ]);

      const acceptanceRate = totalShares > 0 
        ? Math.round((acceptedShares / totalShares) * 100)
        : 0;

      return {
        totalShares,
        sentShares,
        receivedShares,
        acceptedShares,
        pendingShares,
        rejectedShares,
        acceptanceRate,
      };
    } catch (error) {
      logger.error('Error getting sharing statistics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
      });
      return {
        totalShares: 0,
        sentShares: 0,
        receivedShares: 0,
        acceptedShares: 0,
        pendingShares: 0,
        rejectedShares: 0,
        acceptanceRate: 0,
      };
    }
  }

  /**
   * Health check for memory sharing service
   */
  static async healthCheck(): Promise<{ status: string; details: Record<string, unknown> }> {
    try {
      const stats = await this.getSharingStats();
      
      return {
        status: 'healthy',
        details: {
          message: 'Memory sharing service is operational',
          ...stats,
          lastChecked: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

// Export singleton functions
export const memorySharingService = MemorySharingService;
