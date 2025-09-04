import { Request, Response } from 'express';
import { getDatabase } from '../services/database';
import { MediaService } from '../services/mediaService';
import { getReminderService } from '../services/reminderService';
import { getMoodDetectionService } from '../services/moodDetectionService';
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

      // Get reminder statistics
      const reminderService = getReminderService();
      const reminderStats = await reminderService.getReminderStats();

      // Get mood detection statistics from memories with mood data
      const moodStats = await AnalyticsController.getMoodStatistics();

      // Get geo-tagging statistics
      const geoStats = await AnalyticsController.getGeoTaggingStatistics();

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
        reminders: reminderStats,
        moodDetection: moodStats,
        geoTagging: geoStats,
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

  /**
   * Get mood detection statistics from memories
   */
  private static async getMoodStatistics(): Promise<{
    totalMemoriesWithMood: number;
    moodDistribution: Record<string, number>;
    sentimentDistribution: Record<string, number>;
    averageConfidence: number;
    topEmotionalIndicators: Array<{ indicator: string; count: number }>;
    intensityDistribution: Record<string, number>;
  }> {
    try {
      const db = getDatabase();

      // Count memories with mood detection metadata - simplified approach
      const memoriesWithMood = await db.memory.findMany({
        select: {
          tags: true,
        }
      });

      const totalMemoriesWithMood = memoriesWithMood.length;

      // Analyze mood distribution from tags
      const moodCounts: Record<string, number> = {};
      const sentimentCounts: Record<string, number> = {};
      const intensityCounts: Record<string, number> = {};
      const indicatorCounts: Record<string, number> = {};

      const moods = ['happy', 'sad', 'excited', 'stressed', 'anxious', 'angry', 'grateful', 'confused', 'neutral'];
      const sentiments = ['positive', 'negative', 'neutral'];
      const intensities = ['intensity_low', 'intensity_medium', 'intensity_high'];

      memoriesWithMood.forEach(memory => {
        if (Array.isArray(memory.tags)) {
          memory.tags.forEach((tag: any) => {
            const tagStr = String(tag);
            
            // Count moods
            if (moods.includes(tagStr)) {
              moodCounts[tagStr] = (moodCounts[tagStr] || 0) + 1;
            }
            
            // Count sentiments
            if (sentiments.includes(tagStr)) {
              sentimentCounts[tagStr] = (sentimentCounts[tagStr] || 0) + 1;
            }
            
            // Count intensities
            if (intensities.includes(tagStr)) {
              const intensity = tagStr.replace('intensity_', '');
              intensityCounts[intensity] = (intensityCounts[intensity] || 0) + 1;
            }

            // Count all tags as potential emotional indicators
            indicatorCounts[tagStr] = (indicatorCounts[tagStr] || 0) + 1;
          });
        }
      });

      // Get top emotional indicators (excluding common tags)
      const excludedTags = ['location', 'text', 'image', 'audio', 'work', 'home'];
      const topEmotionalIndicators = Object.entries(indicatorCounts)
        .filter(([tag]) => !excludedTags.includes(tag))
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([indicator, count]) => ({ indicator, count }));

      // Calculate average confidence (simplified - in a real implementation, 
      // you'd store actual confidence values)
      const averageConfidence = 0.75; // Mock average

      return {
        totalMemoriesWithMood,
        moodDistribution: moodCounts,
        sentimentDistribution: sentimentCounts,
        averageConfidence,
        topEmotionalIndicators,
        intensityDistribution: intensityCounts,
      };

    } catch (error) {
      logger.error('Error getting mood statistics', { error });
      return {
        totalMemoriesWithMood: 0,
        moodDistribution: {},
        sentimentDistribution: {},
        averageConfidence: 0,
        topEmotionalIndicators: [],
        intensityDistribution: {},
      };
    }
  }

  /**
   * Get geo-tagging statistics from memories
   */
  private static async getGeoTaggingStatistics(): Promise<{
    totalMemoriesWithLocation: number;
    locationTypes: Record<string, number>;
    extractionMethods: Record<string, number>;
    topCities: Array<{ city: string; count: number }>;
    topCountries: Array<{ country: string; count: number }>;
  }> {
    try {
      const db = getDatabase();

      // Count memories with location tags - simplified approach
      const allMemoriesForLocation = await db.memory.findMany({
        select: {
          tags: true,
        }
      });

      const memoriesWithLocation = allMemoriesForLocation.filter(memory => 
        Array.isArray(memory.tags) && memory.tags.some((tag: any) => 
          typeof tag === 'string' && ['location', 'location_whatsapp_location', 'location_text_extraction'].includes(tag)
        )
      );

      const totalMemoriesWithLocation = memoriesWithLocation.length;

      // Analyze location data from tags
      const locationTypeCounts: Record<string, number> = {};
      const extractionMethodCounts: Record<string, number> = {};
      const cityCounts: Record<string, number> = {};
      const countryCounts: Record<string, number> = {};

      const locationTypes = ['home', 'work', 'office', 'restaurant', 'cafe', 'park', 'beach', 'hospital', 'gym'];
      const extractionMethods = ['location_whatsapp_location', 'location_text_extraction', 'location_manual_entry'];

      memoriesWithLocation.forEach(memory => {
        if (Array.isArray(memory.tags)) {
          memory.tags.forEach((tag: any) => {
            const tagStr = String(tag);
            
            // Count location types
            if (locationTypes.includes(tagStr)) {
              locationTypeCounts[tagStr] = (locationTypeCounts[tagStr] || 0) + 1;
            }
            
            // Count extraction methods
            if (extractionMethods.includes(tagStr)) {
              extractionMethodCounts[tagStr] = (extractionMethodCounts[tagStr] || 0) + 1;
            }
            
            // Count cities (tags starting with city_)
            if (tagStr.startsWith('city_')) {
              const city = tagStr.replace('city_', '').replace(/_/g, ' ');
              cityCounts[city] = (cityCounts[city] || 0) + 1;
            }
            
            // Count countries (tags starting with country_)
            if (tagStr.startsWith('country_')) {
              const country = tagStr.replace('country_', '').replace(/_/g, ' ');
              countryCounts[country] = (countryCounts[country] || 0) + 1;
            }
          });
        }
      });

      // Get top cities and countries
      const topCities = Object.entries(cityCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([city, count]) => ({ city, count }));

      const topCountries = Object.entries(countryCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([country, count]) => ({ country, count }));

      return {
        totalMemoriesWithLocation,
        locationTypes: locationTypeCounts,
        extractionMethods: extractionMethodCounts,
        topCities,
        topCountries,
      };

    } catch (error) {
      logger.error('Error getting geo-tagging statistics', { error });
      return {
        totalMemoriesWithLocation: 0,
        locationTypes: {},
        extractionMethods: {},
        topCities: [],
        topCountries: [],
      };
    }
  }
}
