import { Request, Response } from 'express';
import { memorySharingService } from '../services/memorySharingService';
import logger from '../config/logger';
import { BadRequestError, ErrorCodes } from '../utils/errors';

export class MemorySharingController {
  /**
   * Share a memory with another user
   * POST /sharing/share
   */
  static async shareMemory(req: Request, res: Response) {
    try {
      const { memoryId, fromUserId, toPhoneNumber, message } = req.body;

      const sharedMemory = await memorySharingService.shareMemory({
        memoryId,
        fromUserId,
        toPhoneNumber,
        message,
      });

      logger.info('Memory shared via API', {
        shareId: sharedMemory.id,
        memoryId,
        fromUserId,
        toPhoneNumber: toPhoneNumber.slice(-4) + '****', // Mask phone number
        requestId: req.id,
      });

      res.status(201).json({
        data: sharedMemory,
        message: 'Memory shared successfully. The recipient has been notified via WhatsApp.',
      });
    } catch (error) {
      logger.error('Error sharing memory via API', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Accept a shared memory
   * POST /sharing/:shareId/accept
   */
  static async acceptShare(req: Request, res: Response) {
    try {
      const { shareId } = req.params;
      const { toUserId, copyToMyMemories = true } = req.body;

      if (!shareId) {
        return res.status(400).json({
          success: false,
          message: 'Share ID is required'
        });
      }

      const acceptedShare = await memorySharingService.acceptMemoryShare({
        shareId,
        toUserId,
        copyToMyMemories,
      });

      logger.info('Memory share accepted via API', {
        shareId,
        toUserId,
        copyToMyMemories,
        requestId: req.id,
      });

      return res.json({
        success: true,
        data: acceptedShare,
        message: copyToMyMemories 
          ? 'Memory share accepted and added to your memories!'
          : 'Memory share accepted!',
      });
    } catch (error) {
      logger.error('Error accepting memory share via API', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Reject a shared memory
   * POST /sharing/:shareId/reject
   */
  static async rejectShare(req: Request, res: Response) {
    try {
      const { shareId } = req.params;
      const { toUserId } = req.body;

      if (!shareId) {
        return res.status(400).json({
          success: false,
          message: 'Share ID is required'
        });
      }

      const rejectedShare = await memorySharingService.rejectMemoryShare(shareId, toUserId);

      logger.info('Memory share rejected via API', {
        shareId,
        toUserId,
        requestId: req.id,
      });

      return res.json({
        success: true,
        data: rejectedShare,
        message: 'Memory share rejected.',
      });
    } catch (error) {
      logger.error('Error rejecting memory share via API', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Get user's memory shares
   * GET /sharing/shares
   */
  static async getUserShares(req: Request, res: Response) {
    try {
      const { userId, type = 'all', status } = req.query;

      if (!userId) {
        throw new BadRequestError('userId is required', ErrorCodes.MISSING_REQUIRED_FIELD);
      }

      const shares = await memorySharingService.getUserMemoryShares(
        userId as string,
        type as 'sent' | 'received' | 'all',
        status as 'PENDING' | 'ACCEPTED' | 'REJECTED' | undefined
      );

      logger.info('Retrieved user memory shares', {
        userId,
        type,
        status,
        count: shares.length,
        requestId: req.id,
      });

      res.json({
        data: shares,
        meta: {
          userId,
          type,
          status,
          count: shares.length,
        },
      });
    } catch (error) {
      logger.error('Error retrieving user memory shares', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Get pending shares for a user
   * GET /sharing/pending
   */
  static async getPendingShares(req: Request, res: Response) {
    try {
      const { userId } = req.query;

      if (!userId) {
        throw new BadRequestError('userId is required', ErrorCodes.MISSING_REQUIRED_FIELD);
      }

      const pendingShares = await memorySharingService.getUserMemoryShares(
        userId as string,
        'received',
        'PENDING'
      );

      logger.info('Retrieved pending memory shares', {
        userId,
        count: pendingShares.length,
        requestId: req.id,
      });

      res.json({
        data: pendingShares,
        meta: {
          userId,
          type: 'received',
          status: 'PENDING',
          count: pendingShares.length,
        },
      });
    } catch (error) {
      logger.error('Error retrieving pending memory shares', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Get memory sharing statistics
   * GET /sharing/stats
   */
  static async getSharingStats(req: Request, res: Response) {
    try {
      const { userId } = req.query;

      const stats = await memorySharingService.getSharingStats(userId as string | undefined);

      logger.info('Generated memory sharing statistics', {
        userId: userId || 'all_users',
        totalShares: stats.totalShares,
        acceptanceRate: stats.acceptanceRate,
        requestId: req.id,
      });

      res.json({
        data: {
          ...stats,
          generatedAt: new Date().toISOString(),
          scope: userId ? 'user' : 'global',
        },
      });
    } catch (error) {
      logger.error('Error generating memory sharing statistics', { error, requestId: req.id });
      throw error;
    }
  }

  /**
   * Get memory sharing service health
   * GET /sharing/health
   */
  static async getServiceHealth(req: Request, res: Response) {
    try {
      const healthStatus = await memorySharingService.healthCheck();

      logger.info('Memory sharing service health check completed', {
        status: healthStatus.status,
        requestId: req.id,
      });

      res.json({
        data: healthStatus,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error checking memory sharing service health', { error, requestId: req.id });
      
      res.status(503).json({
        data: {
          status: 'unhealthy',
          details: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Respond to share via WhatsApp-style commands
   * POST /sharing/respond
   */
  static async respondToShare(req: Request, res: Response) {
    try {
      const { shareId, userId, action } = req.body;

      if (!['accept', 'reject'].includes(action)) {
        throw new BadRequestError(
          'Action must be either "accept" or "reject"',
          ErrorCodes.INVALID_INPUT
        );
      }

      let result;
      if (action === 'accept') {
        result = await memorySharingService.acceptMemoryShare({
          shareId,
          toUserId: userId,
          copyToMyMemories: true,
        });
      } else {
        result = await memorySharingService.rejectMemoryShare(shareId, userId);
      }

      logger.info('Share response processed', {
        shareId,
        userId,
        action,
        requestId: req.id,
      });

      res.json({
        data: result,
        message: action === 'accept' 
          ? 'Memory share accepted and added to your collection!'
          : 'Memory share rejected.',
        action,
      });
    } catch (error) {
      logger.error('Error processing share response', { error, requestId: req.id });
      throw error;
    }
  }
}
