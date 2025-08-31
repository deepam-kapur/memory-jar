import { getDatabase } from './database';
import logger from '../config/logger';
import { zonedTimeToUtc, utcToZonedTime, format } from 'date-fns-tz';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, subWeeks, subMonths } from 'date-fns';

export interface TimeFilter {
  startDate?: Date;
  endDate?: Date;
  relativeTime?: string;
}

export class TimezoneService {
  private db = getDatabase();

  /**
   * Detect timezone from phone number (enhanced implementation)
   */
  detectTimezoneFromPhoneNumber(phoneNumber: string): string {
    // Enhanced timezone detection based on phone number patterns
    // In production, this would use IP geolocation or user preferences
    
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    // US/Canada numbers
    if (cleanNumber.startsWith('1') && cleanNumber.length === 11) {
      // More specific US timezone detection based on area codes
      const areaCode = cleanNumber.substring(1, 4);
      if (['212', '646', '917', '347', '929'].includes(areaCode)) {
        return 'America/New_York'; // NYC
      } else if (['213', '323', '424', '747', '818'].includes(areaCode)) {
        return 'America/Los_Angeles'; // LA
      } else if (['312', '773', '872'].includes(areaCode)) {
        return 'America/Chicago'; // Chicago
      }
      return 'America/New_York'; // Default US Eastern
    }
    
    // UK numbers
    if (cleanNumber.startsWith('44')) {
      return 'Europe/London';
    }
    
    // Indian numbers
    if (cleanNumber.startsWith('91')) {
      return 'Asia/Kolkata';
    }
    
    // Australian numbers
    if (cleanNumber.startsWith('61')) {
      return 'Australia/Sydney';
    }
    
    // German numbers
    if (cleanNumber.startsWith('49')) {
      return 'Europe/Berlin';
    }
    
    // French numbers
    if (cleanNumber.startsWith('33')) {
      return 'Europe/Paris';
    }
    
    // Japanese numbers
    if (cleanNumber.startsWith('81')) {
      return 'Asia/Tokyo';
    }
    
    // Default to UTC
    return 'UTC';
  }

  /**
   * Update user timezone
   */
  async updateUserTimezone(userId: string, timezone: string): Promise<void> {
    try {
      await this.db.user.update({
        where: { id: userId },
        data: { timezone },
      });
      
      logger.info('User timezone updated', { userId, timezone });
    } catch (error) {
      logger.error('Error updating user timezone', { userId, timezone, error });
      throw error;
    }
  }

  /**
   * Parse time-based queries and return date filters with proper timezone handling
   */
  async parseTimeQuery(query: string, userId: string): Promise<TimeFilter> {
    const lowerQuery = query.toLowerCase();
    const userTimezone = await this.getUserTimezone(userId);
    
    // Get current time in user's timezone
    const nowInUserTz = utcToZonedTime(new Date(), userTimezone);
    
    if (lowerQuery.includes('yesterday')) {
      const yesterday = subDays(nowInUserTz, 1);
      return {
        startDate: zonedTimeToUtc(startOfDay(yesterday), userTimezone),
        endDate: zonedTimeToUtc(endOfDay(yesterday), userTimezone),
        relativeTime: 'yesterday'
      };
    }
    
    if (lowerQuery.includes('today')) {
      return {
        startDate: zonedTimeToUtc(startOfDay(nowInUserTz), userTimezone),
        endDate: zonedTimeToUtc(endOfDay(nowInUserTz), userTimezone),
        relativeTime: 'today'
      };
    }
    
    if (lowerQuery.includes('last week')) {
      const lastWeekStart = subWeeks(nowInUserTz, 1);
      return {
        startDate: zonedTimeToUtc(startOfWeek(lastWeekStart), userTimezone),
        endDate: zonedTimeToUtc(endOfWeek(lastWeekStart), userTimezone),
        relativeTime: 'last week'
      };
    }
    
    if (lowerQuery.includes('this week')) {
      return {
        startDate: zonedTimeToUtc(startOfWeek(nowInUserTz), userTimezone),
        endDate: zonedTimeToUtc(endOfDay(nowInUserTz), userTimezone),
        relativeTime: 'this week'
      };
    }
    
    if (lowerQuery.includes('last month')) {
      const lastMonth = subMonths(nowInUserTz, 1);
      return {
        startDate: zonedTimeToUtc(startOfMonth(lastMonth), userTimezone),
        endDate: zonedTimeToUtc(endOfMonth(lastMonth), userTimezone),
        relativeTime: 'last month'
      };
    }
    
    if (lowerQuery.includes('this month')) {
      return {
        startDate: zonedTimeToUtc(startOfMonth(nowInUserTz), userTimezone),
        endDate: zonedTimeToUtc(endOfDay(nowInUserTz), userTimezone),
        relativeTime: 'this month'
      };
    }
    
    if (lowerQuery.includes('recent')) {
      const recentStart = subDays(nowInUserTz, 7);
      return {
        startDate: zonedTimeToUtc(startOfDay(recentStart), userTimezone),
        endDate: zonedTimeToUtc(endOfDay(nowInUserTz), userTimezone),
        relativeTime: 'recent'
      };
    }
    
    if (lowerQuery.includes('old')) {
      const oldStart = subDays(nowInUserTz, 30);
      const oldEnd = subDays(nowInUserTz, 7);
      return {
        startDate: zonedTimeToUtc(startOfDay(oldStart), userTimezone),
        endDate: zonedTimeToUtc(endOfDay(oldEnd), userTimezone),
        relativeTime: 'old'
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
   * Validate timezone string
   */
  isValidTimezone(timezone: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format date for user's timezone
   */
  async formatDateForUser(date: Date, userId: string): Promise<string> {
    const userTimezone = await this.getUserTimezone(userId);
    return format(utcToZonedTime(date, userTimezone), 'MMM dd, yyyy HH:mm', { timeZone: userTimezone });
  }

  /**
   * Convert UTC date to user's timezone
   */
  async convertToUserTimezone(date: Date, userId: string): Promise<Date> {
    const userTimezone = await this.getUserTimezone(userId);
    return utcToZonedTime(date, userTimezone);
  }

  /**
   * Convert user timezone date to UTC
   */
  async convertFromUserTimezone(date: Date, userId: string): Promise<Date> {
    const userTimezone = await this.getUserTimezone(userId);
    return zonedTimeToUtc(date, userTimezone);
  }

  /**
   * Get timezone offset for user
   */
  async getUserTimezoneOffset(userId: string): Promise<number> {
    const userTimezone = await this.getUserTimezone(userId);
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const userTime = new Date(utcTime + (this.getTimezoneOffsetMinutes(userTimezone) * 60000));
    return userTime.getTimezoneOffset();
  }

  /**
   * Get timezone offset in minutes
   */
  private getTimezoneOffsetMinutes(timezone: string): number {
    const now = new Date();
    const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    return (local.getTime() - utc.getTime()) / (1000 * 60);
  }
}

let timezoneServiceInstance: TimezoneService | null = null;

export const getTimezoneService = (): TimezoneService => {
  if (!timezoneServiceInstance) {
    timezoneServiceInstance = new TimezoneService();
  }
  return timezoneServiceInstance;
};
