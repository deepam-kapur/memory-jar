import { TimezoneService, getTimezoneService } from '../services/timezoneService';
import { getDatabase } from '../services/database';

// Mock the database
jest.mock('../services/database');
const mockDb = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};
(getDatabase as jest.Mock).mockReturnValue(mockDb);

describe('TimezoneService', () => {
  let timezoneService: TimezoneService;

  beforeEach(() => {
    timezoneService = getTimezoneService();
    jest.clearAllMocks();
  });

  describe('detectTimezoneFromPhoneNumber', () => {
    it('should detect US Eastern timezone for NYC area codes', () => {
      const timezone = timezoneService.detectTimezoneFromPhoneNumber('+12125551234');
      expect(timezone).toBe('America/New_York');
    });

    it('should detect US Pacific timezone for LA area codes', () => {
      const timezone = timezoneService.detectTimezoneFromPhoneNumber('+12135551234');
      expect(timezone).toBe('America/Los_Angeles');
    });

    it('should detect US Central timezone for Chicago area codes', () => {
      const timezone = timezoneService.detectTimezoneFromPhoneNumber('+13125551234');
      expect(timezone).toBe('America/Chicago');
    });

    it('should detect UK timezone for UK numbers', () => {
      const timezone = timezoneService.detectTimezoneFromPhoneNumber('+447911123456');
      expect(timezone).toBe('Europe/London');
    });

    it('should detect Indian timezone for Indian numbers', () => {
      const timezone = timezoneService.detectTimezoneFromPhoneNumber('+919876543210');
      expect(timezone).toBe('Asia/Kolkata');
    });

    it('should default to UTC for unknown numbers', () => {
      const timezone = timezoneService.detectTimezoneFromPhoneNumber('+999999999999');
      expect(timezone).toBe('UTC');
    });

    it('should handle phone numbers with formatting', () => {
      const timezone = timezoneService.detectTimezoneFromPhoneNumber('+1 (212) 555-1234');
      expect(timezone).toBe('America/New_York');
    });
  });

  describe('parseTimeQuery', () => {
    beforeEach(() => {
      mockDb.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    });

    it('should parse "yesterday" queries', async () => {
      const result = await timezoneService.parseTimeQuery('show me memories from yesterday', 'user123');
      
      expect(result.relativeTime).toBe('yesterday');
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
    });

    it('should parse "today" queries', async () => {
      const result = await timezoneService.parseTimeQuery('what did I do today', 'user123');
      
      expect(result.relativeTime).toBe('today');
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
    });

    it('should parse "last week" queries', async () => {
      const result = await timezoneService.parseTimeQuery('memories from last week', 'user123');
      
      expect(result.relativeTime).toBe('last week');
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
    });

    it('should parse "this week" queries', async () => {
      const result = await timezoneService.parseTimeQuery('this week memories', 'user123');
      
      expect(result.relativeTime).toBe('this week');
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
    });

    it('should parse "last month" queries', async () => {
      const result = await timezoneService.parseTimeQuery('last month activities', 'user123');
      
      expect(result.relativeTime).toBe('last month');
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
    });

    it('should parse "recent" queries', async () => {
      const result = await timezoneService.parseTimeQuery('recent memories', 'user123');
      
      expect(result.relativeTime).toBe('recent');
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
    });

    it('should return empty object for non-time queries', async () => {
      const result = await timezoneService.parseTimeQuery('find my grocery list', 'user123');
      
      expect(result).toEqual({});
    });

    it('should handle database errors gracefully', async () => {
      mockDb.user.findUnique.mockRejectedValue(new Error('Database error'));
      
      const result = await timezoneService.parseTimeQuery('yesterday memories', 'user123');
      
      expect(result.relativeTime).toBe('yesterday');
      // Should still work with UTC fallback
    });
  });

  describe('updateUserTimezone', () => {
    it('should update user timezone successfully', async () => {
      mockDb.user.update.mockResolvedValue({ id: 'user123', timezone: 'Europe/London' });
      
      await timezoneService.updateUserTimezone('user123', 'Europe/London');
      
      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user123' },
        data: { timezone: 'Europe/London' },
      });
    });

    it('should handle database errors', async () => {
      mockDb.user.update.mockRejectedValue(new Error('Database error'));
      
      await expect(timezoneService.updateUserTimezone('user123', 'Europe/London'))
        .rejects.toThrow('Database error');
    });
  });

  describe('isValidTimezone', () => {
    it('should validate correct timezone strings', () => {
      expect(timezoneService.isValidTimezone('America/New_York')).toBe(true);
      expect(timezoneService.isValidTimezone('Europe/London')).toBe(true);
      expect(timezoneService.isValidTimezone('Asia/Tokyo')).toBe(true);
      expect(timezoneService.isValidTimezone('UTC')).toBe(true);
    });

    it('should reject invalid timezone strings', () => {
      expect(timezoneService.isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(timezoneService.isValidTimezone('NotATimezone')).toBe(false);
      expect(timezoneService.isValidTimezone('')).toBe(false);
    });
  });

  describe('formatDateForUser', () => {
    beforeEach(() => {
      mockDb.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    });

    it('should format date for user timezone', async () => {
      const date = new Date('2024-01-15T12:00:00Z');
      const formatted = await timezoneService.formatDateForUser(date, 'user123');
      
      expect(formatted).toMatch(/Jan 15, 2024/);
    });

    it('should handle database errors gracefully', async () => {
      mockDb.user.findUnique.mockRejectedValue(new Error('Database error'));
      
      const date = new Date('2024-01-15T12:00:00Z');
      const formatted = await timezoneService.formatDateForUser(date, 'user123');
      
      // Should still format with UTC fallback
      expect(formatted).toMatch(/Jan 15, 2024/);
    });
  });

  describe('convertToUserTimezone', () => {
    beforeEach(() => {
      mockDb.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    });

    it('should convert UTC date to user timezone', async () => {
      const utcDate = new Date('2024-01-15T12:00:00Z');
      const userDate = await timezoneService.convertToUserTimezone(utcDate, 'user123');
      
      expect(userDate).toBeInstanceOf(Date);
      // The converted date should be different from UTC (unless user is in UTC)
    });
  });

  describe('convertFromUserTimezone', () => {
    beforeEach(() => {
      mockDb.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    });

    it('should convert user timezone date to UTC', async () => {
      const userDate = new Date('2024-01-15T12:00:00');
      const utcDate = await timezoneService.convertFromUserTimezone(userDate, 'user123');
      
      expect(utcDate).toBeInstanceOf(Date);
    });
  });
});
