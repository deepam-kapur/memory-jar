import { Request, Response } from 'express';
import { getDatabase } from '../services/database';
import { MediaService } from '../services/mediaService';
import logger from '../config/logger';

export class AnalyticsController {
  /**
   * Get analytics summary from DB
   * GET /analytics/summary
   */
  static async getAnalyticsSummary(req: Request, res: Response) {
    try {
      const db = getDatabase();

      // Get basic counts
      const [totalUsers, totalInteractions, totalMemories, totalMediaFiles] = await Promise.all([
        db.user.count({ where: { isActive: true } }),
        db.interaction.count(),
        db.memory.count(),
        db.mediaFile.count(),
      ]);

      // Get memories by type
      const memoriesByType = await db.memory.groupBy({
        by: ['memoryType'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      });

      // Get average importance
      const avgImportance = await db.memory.aggregate({
        _avg: { importance: true },
      });

      // Get recent activity (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentActivity = await db.interaction.count({
        where: {
          timestamp: {
            gte: sevenDaysAgo,
          },
        },
      });

      // Get top tags (if any memories have tags)
      const memoriesWithTags = await db.memory.findMany({
        where: {
          tags: { not: "null" },
        },
        select: { tags: true },
      });

      const tagCounts: Record<string, number> = {};
      memoriesWithTags.forEach(memory => {
        if (memory.tags && Array.isArray(memory.tags)) {
          memory.tags.forEach((tag: any) => {
            if (typeof tag === 'string') {
              tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            }
          });
        }
      });

      const topTags = Object.entries(tagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));

      // Get last ingest time
      const lastInteraction = await db.interaction.findFirst({
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      });

      // Get media deduplication statistics
      const mediaStats = await MediaService.getMediaStats();

      // Get interactions by message type
      const interactionsByType = await db.interaction.groupBy({
        by: ['messageType'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      });

      // Get interactions by status
      const interactionsByStatus = await db.interaction.groupBy({
        by: ['status'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      });

      const analytics = {
        overview: {
          totalUsers,
          totalInteractions,
          totalMemories,
          totalMediaFiles,
          averageImportance: avgImportance._avg.importance || 0,
          recentActivity7Days: recentActivity,
        },
        memoriesByType: memoriesByType.map(item => ({
          type: item.memoryType,
          count: item._count.id,
        })),
        interactionsByType: interactionsByType.map(item => ({
          type: item.messageType,
          count: item._count.id,
        })),
        interactionsByStatus: interactionsByStatus.map(item => ({
          status: item.status,
          count: item._count.id,
        })),
        mediaDeduplication: {
          totalFiles: mediaStats.totalFiles,
          uniqueFiles: mediaStats.uniqueFiles,
          totalSize: mediaStats.totalSize,
          deduplicationRate: mediaStats.deduplicationRate,
          byType: mediaStats.byType,
        },
        topTags,
        lastIngestTime: lastInteraction?.timestamp || null,
        generatedAt: new Date().toISOString(),
      };

      logger.info('Generated analytics summary', {
        totalUsers,
        totalInteractions,
        totalMemories,
        totalMediaFiles,
        mediaDeduplicationRate: mediaStats.deduplicationRate,
      });

      res.json({
        data: analytics,
      });

    } catch (error) {
      logger.error('Error generating analytics summary', { error });
      throw error;
    }
  }
}
