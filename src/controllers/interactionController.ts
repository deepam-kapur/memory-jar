import { Request, Response } from 'express';
import { getDatabase } from '../services/database';
import logger from '../config/logger';

export class InteractionController {
  /**
   * Get recent interactions from DB
   * GET /interactions/recent?limit=<n>
   */
  static async getRecentInteractions(req: Request, res: Response) {
    try {
      const { limit = 20, page = 1 } = req.query;
      const db = getDatabase();

      const skip = (Number(page) - 1) * Number(limit);
      const take = Number(limit);

      const [interactions, total] = await Promise.all([
        db.interaction.findMany({
          skip,
          take,
          orderBy: { timestamp: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                phoneNumber: true,
                name: true,
              },
            },
          },
        }),
        db.interaction.count(),
      ]);

      const totalPages = Math.ceil(total / take);

      logger.info('Retrieved recent interactions', {
        count: interactions.length,
        total,
        page: Number(page),
        limit: Number(limit),
      });

      res.json({
        data: interactions,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: totalPages,
          hasNext: Number(page) < totalPages,
          hasPrev: Number(page) > 1,
        },
      });

    } catch (error) {
      logger.error('Error retrieving recent interactions', { error });
      throw error;
    }
  }
}
