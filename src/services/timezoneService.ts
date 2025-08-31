import { getDatabase } from './database';
import logger from '../config/logger';

export interface TimeFilter {
  startDate?: Date;
  endDate?: Date;
  relativeTime?: string;
}

export class TimezoneService {
  private db = getDatabase();

  /**
   * Detect timezone from phone number (simplified implementation)
   */
  detectTimezoneFromPhoneNumber(phoneNumber: string): string {
    // Simplified timezone detection based on phone number patterns
    // In production, this would use IP geolocation or user preferences
    
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    // US/Canada numbers
    if (cleanNumber.startsWith('1') && cleanNumber.length === 11) {
      return 'America/New_York';
    }
    
    // UK numbers
    if (cleanNumber.startsWith('44')) {
      return 'Europe/London';
    }
    
    // Indian numbers
    if (cleanNumber.startsWith('91')) {
      return 'Asia/Kolkata';
    }
    
    // Default to UTC
    return 'UTC';
  }

  /**
   * Parse time-based queries and return date filters
   */
  async parseTimeQuery(query: string, userId: string): Promise<TimeFilter> {
    const lowerQuery = query.toLowerCase();
    const now = new Date();
    
    // Get user's timezone
    const userTimezone = await this.getUserTimezone(userId);
    
    if (lowerQuery.includes('yesterday')) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        startDate: this.startOfDay(yesterday, userTimezone),
        endDate: this.endOfDay(yesterday, userTimezone),
        relativeTime: 'yesterday'
      };
    }
    
    if (lowerQuery.includes('today')) {
      return {
        startDate: this.startOfDay(now, userTimezone),
        endDate: this.endOfDay(now, userTimezone),
        relativeTime: 'today'
      };
    }
    
    if (lowerQuery.includes('last week')) {
      const lastWeekStart = new Date(now);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      return {
        startDate: this.startOfDay(lastWeekStart, userTimezone),
        endDate: this.endOfDay(now, userTimezone),
        relativeTime: 'last week'
      };
    }
    
    if (lowerQuery.includes('this week')) {
      const weekStart = this.startOfWeek(now, userTimezone);
      return {
        startDate: weekStart,
        endDate: this.endOfDay(now, userTimezone),
        relativeTime: 'this week'
      };
    }
    
    if (lowerQuery.includes('last month')) {
      const lastMonth = new Date(now);
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      return {
        startDate: this.startOfMonth(lastMonth, userTimezone),
        endDate: this.endOfMonth(lastMonth, userTimezone),
        relativeTime: 'last month'
      };
    }
    
    if (lowerQuery.includes('this month')) {
      return {
        startDate: this.startOfMonth(now, userTimezone),
        endDate: this.endOfDay(now, userTimezone),
        relativeTime: 'this month'
      };
    }
    
    if (lowerQuery.includes('recent') || lowerQuery.includes('old')) {
      const recentDays = lowerQuery.includes('recent') ? 7 : 30;
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - recentDays);
      return {
        startDate: this.startOfDay(startDate, userTimezone),
        endDate: this.endOfDay(now, userTimezone),
        relativeTime: lowerQuery.includes('recent') ? 'recent' : 'old'
      };
    }
    
    // No time filter
    return {};
  }

  /**
   * Get user's timezone
   */
  private async getUserTimezone(userId: string): Promise<string> {
    try {
      // Query the database for user's timezone
      const user = await this.db.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      
      return user?.timezone || 'UTC';
    } catch (error) {
      logger.warn('Error getting user timezone, using default', { userId, error });
      return 'UTC';
    }
  }

  /**
   * Get start of day in user's timezone
   */
  private startOfDay(date: Date, timezone: string): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Get end of day in user's timezone
   */
  private endOfDay(date: Date, timezone: string): Date {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  /**
   * Get start of week in user's timezone
   */
  private startOfWeek(date: Date, timezone: string): Date {
    const result = new Date(date);
    const day = result.getDay();
    const diff = result.getDate() - day;
    result.setDate(diff);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Get start of month in user's timezone
   */
  private startOfMonth(date: Date, timezone: string): Date {
    const result = new Date(date);
    result.setDate(1);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  /**
   * Get end of month in user's timezone
   */
  private endOfMonth(date: Date, timezone: string): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + 1);
    result.setDate(0);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  /**
   * Format date for user's timezone
   */
  async formatDateForUser(date: Date, userId: string): Promise<string> {
    const userTimezone = await this.getUserTimezone(userId);
    return date.toLocaleDateString('en-US', {
      timeZone: userTimezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Convert UTC date to user's timezone
   */
  async convertToUserTimezone(date: Date, userId: string): Promise<Date> {
    const userTimezone = await this.getUserTimezone(userId);
    // Simple conversion - in production would use proper timezone library
    return date;
  }
}

let timezoneServiceInstance: TimezoneService | null = null;

export const getTimezoneService = (): TimezoneService => {
  if (!timezoneServiceInstance) {
    timezoneServiceInstance = new TimezoneService();
  }
  return timezoneServiceInstance;
};
