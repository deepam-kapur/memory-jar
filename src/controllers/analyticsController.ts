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

      // Get memories by type (manual grouping)
      const allMemories = await db.memory.findMany({
        select: { memoryType: true },
      });
      const typeCounts: Record<string, number> = {};
      allMemories.forEach(memory => {
        typeCounts[memory.memoryType] = (typeCounts[memory.memoryType] || 0) + 1;
      });
      const memoriesByType = Object.entries(typeCounts).map(([type, count]) => ({
        type,
        count,
      }));

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

      // Get interactions by message type (manual grouping)
      const allInteractions = await db.interaction.findMany({
        select: { messageType: true, status: true },
      });
      
      const interactionTypeCounts: Record<string, number> = {};
      const interactionStatusCounts: Record<string, number> = {};
      
      allInteractions.forEach(interaction => {
        interactionTypeCounts[interaction.messageType] = (interactionTypeCounts[interaction.messageType] || 0) + 1;
        interactionStatusCounts[interaction.status] = (interactionStatusCounts[interaction.status] || 0) + 1;
      });
      
      const interactionsByType = Object.entries(interactionTypeCounts).map(([type, count]) => ({
        type,
        count,
      }));
      
      const interactionsByStatus = Object.entries(interactionStatusCounts).map(([status, count]) => ({
        status,
        count,
      }));

      const analytics = {
        overview: {
          totalUsers,
          totalInteractions,
          totalMemories,
          totalMediaFiles,
          averageImportance: avgImportance._avg.importance || 0,
          recentActivity7Days: recentActivity,
        },
        memoriesByType,
        interactionsByType,
        interactionsByStatus,
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
