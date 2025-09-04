import { 
  whatsAppWebhookSchema,
  createMemorySchema,
  searchMemoriesSchema,
  paginationSchema,
  createReminderSchema,
  shareMemorySchema,
  phoneNumberSchema,
  cuidSchema,
} from '../validation/schemas';
import { z } from 'zod';

describe('Validation Schemas', () => {
  describe('whatsAppWebhookSchema', () => {
    it('should validate valid WhatsApp webhook payload', () => {
      const validPayload = {
        MessageSid: 'SM1234567890abcdef',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        Body: 'Hello world',
        NumMedia: '0',
        Timestamp: '1699876543',
        AccountSid: 'AC1234567890abcdef',
      };

      const result = whatsAppWebhookSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it('should validate webhook payload with media', () => {
      const mediaPayload = {
        MessageSid: 'SM1234567890abcdef',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        Body: 'Check this image',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/123.jpg',
        MediaContentType0: 'image/jpeg',
        MediaSid0: 'ME123456789',
        Timestamp: '1699876543',
        AccountSid: 'AC1234567890abcdef',
      };

      const result = whatsAppWebhookSchema.safeParse(mediaPayload);
      expect(result.success).toBe(true);
    });

    it('should reject payload missing required fields', () => {
      const invalidPayload = {
        MessageSid: 'SM1234567890abcdef',
        // Missing From, To, etc.
      };

      const result = whatsAppWebhookSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(2); // From and To are required
      }
    });

    it('should validate flexible phone number formats in webhook', () => {
      const validPayload = {
        MessageSid: 'SM1234567890abcdef',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+0987654321',
        NumMedia: '0',
        Timestamp: '1699876543',
        AccountSid: 'AC1234567890abcdef',
      };

      const result = whatsAppWebhookSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });
  });

  describe('createMemorySchema', () => {
    it('should validate valid memory creation data', () => {
      const validData = {
        userId: 'clh1234567890abcdefghijkl',
        content: 'This is a test memory',
        memoryType: 'TEXT',
        importance: 7,
        tags: ['test', 'memory'],
      };

      const result = createMemorySchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe(validData.userId);
        expect(result.data.content).toBe(validData.content);
        expect(result.data.importance).toBe(7);
      }
    });

    it('should validate memory with interaction', () => {
      const dataWithInteraction = {
        userId: 'clh1234567890abcdefghijkl',
        interactionId: 'clh0987654321fedcbakjihg',
        content: 'Memory from interaction',
        memoryType: 'IMAGE',
        mediaUrls: ['https://example.com/image.jpg'],
        transcript: 'This is what I see',
      };

      const result = createMemorySchema.safeParse(dataWithInteraction);
      expect(result.success).toBe(true);
    });

    it('should reject invalid memory type', () => {
      const invalidData = {
        userId: 'clh1234567890abcdefghijkl',
        content: 'Test memory',
        memoryType: 'INVALID_TYPE',
      };

      const result = createMemorySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject importance out of range', () => {
      const invalidData = {
        userId: 'clh1234567890abcdefghijkl',
        content: 'Test memory',
        memoryType: 'TEXT',
        importance: 11, // Should be 1-10
      };

      const result = createMemorySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty content', () => {
      const invalidData = {
        userId: 'clh1234567890abcdefghijkl',
        content: '',
        memoryType: 'TEXT',
      };

      const result = createMemorySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid CUID format', () => {
      const invalidData = {
        userId: 'invalid-cuid',
        content: 'Test memory',
        memoryType: 'TEXT',
      };

      const result = createMemorySchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('searchMemoriesSchema', () => {
    it('should validate search with query only', () => {
      const validSearch = {
        query: 'find my memories about work',
      };

      const result = searchMemoriesSchema.safeParse(validSearch);
      expect(result.success).toBe(true);
    });

    it('should validate search with all optional fields', () => {
      const completeSearch = {
        query: 'happy memories',
        userId: 'clh1234567890abcdefghijkl',
        memoryType: 'IMAGE',
        tags: ['vacation', 'family'],
        limit: 20,
        minImportance: 5,
        maxImportance: 10,
      };

      const result = searchMemoriesSchema.safeParse(completeSearch);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
        expect(result.data.minImportance).toBe(5);
      }
    });

    it('should reject missing query', () => {
      const invalidSearch = {
        userId: 'clh1234567890abcdefghijkl',
      };

      const result = searchMemoriesSchema.safeParse(invalidSearch);
      expect(result.success).toBe(false);
    });

    it('should reject limit over maximum', () => {
      const invalidSearch = {
        query: 'test',
        limit: 101, // Over max of 100
      };

      const result = searchMemoriesSchema.safeParse(invalidSearch);
      expect(result.success).toBe(false);
    });

    it('should reject invalid memory type', () => {
      const invalidSearch = {
        query: 'test',
        memoryType: 'INVALID_TYPE',
      };

      const result = searchMemoriesSchema.safeParse(invalidSearch);
      expect(result.success).toBe(false);
    });
  });

  describe('paginationSchema', () => {
    it('should validate valid pagination parameters', () => {
      const validPagination = {
        page: '1',
        limit: '10',
      };

      const result = paginationSchema.safeParse(validPagination);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(10);
      }
    });

    it('should use default values when not provided', () => {
      const emptyPagination = {};

      const result = paginationSchema.safeParse(emptyPagination);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
      }
    });

    it('should enforce maximum limit', () => {
      const invalidPagination = {
        page: '1',
        limit: '101', // Over max of 100
      };

      const result = paginationSchema.safeParse(invalidPagination);
      expect(result.success).toBe(false);
    });

    it('should reject negative page numbers', () => {
      const invalidPagination = {
        page: '0',
        limit: '10',
      };

      const result = paginationSchema.safeParse(invalidPagination);
      expect(result.success).toBe(false);
    });
  });

  describe('createReminderSchema', () => {
    it('should validate valid reminder data', () => {
      const validReminder = {
        userId: 'clh1234567890abcdefghijkl',
        memoryId: 'clh0987654321fedcbakjihg',
        naturalLanguageTime: 'tomorrow at 3 PM',
        message: 'Call the dentist',
        timezone: 'America/New_York',
      };

      const result = createReminderSchema.safeParse(validReminder);
      expect(result.success).toBe(true);
    });

    it('should validate reminder with scheduled time', () => {
      const reminderWithScheduled = {
        userId: 'clh1234567890abcdefghijkl',
        memoryId: 'clh0987654321fedcbakjihg',
        scheduledFor: '2024-12-01T15:30:00Z',
        message: 'Review quarterly goals',
        timezone: 'UTC',
      };

      const result = createReminderSchema.safeParse(reminderWithScheduled);
      expect(result.success).toBe(true);
    });

    it('should reject empty message', () => {
      const invalidReminder = {
        userId: 'clh1234567890abcdefghijkl',
        memoryId: 'clh0987654321fedcbakjihg',
        naturalLanguageTime: 'tomorrow',
        message: '',
        timezone: 'UTC',
      };

      const result = createReminderSchema.safeParse(invalidReminder);
      expect(result.success).toBe(false);
    });

    it('should reject missing time fields', () => {
      const invalidReminder = {
        userId: 'clh1234567890abcdefghijkl',
        memoryId: 'clh0987654321fedcbakjihg',
        message: 'Test reminder',
        timezone: 'UTC',
      };

      const result = createReminderSchema.safeParse(invalidReminder);
      expect(result.success).toBe(false);
    });
  });

  describe('shareMemorySchema', () => {
    it('should validate valid memory sharing data', () => {
      const validShare = {
        memoryId: 'clh1234567890abcdefghijkl',
        fromUserId: 'clh0987654321fedcbakjihg',
        toPhoneNumber: '+1234567890',
        message: 'Check out this memory!',
      };

      const result = shareMemorySchema.safeParse(validShare);
      expect(result.success).toBe(true);
    });

    it('should validate share without message', () => {
      const shareWithoutMessage = {
        memoryId: 'clh1234567890abcdefghijkl',
        fromUserId: 'clh0987654321fedcbakjihg',
        toPhoneNumber: '+1234567890',
      };

      const result = shareMemorySchema.safeParse(shareWithoutMessage);
      expect(result.success).toBe(true);
    });

    it('should reject invalid phone number', () => {
      const invalidShare = {
        memoryId: 'clh1234567890abcdefghijkl',
        fromUserId: 'clh0987654321fedcbakjihg',
        toPhoneNumber: 'invalid-phone',
      };

      const result = shareMemorySchema.safeParse(invalidShare);
      expect(result.success).toBe(false);
    });
  });

  describe('phoneNumberSchema', () => {
    it('should validate various phone number formats', () => {
      const validNumbers = [
        '+1234567890',
        '+44123456789',
        '+918427285073',
        'whatsapp:+1234567890',
        '+12345678901',
      ];

      validNumbers.forEach(number => {
        const result = phoneNumberSchema.safeParse(number);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid phone numbers', () => {
      const invalidNumbers = [
        '1234567890', // No plus sign
        '+123', // Too short (less than 8 digits after country code)
        '+123456789012345678901', // Too long
        'invalid-phone',
        '',
        '+abc123456789',
        '+0123456789', // Starts with 0 after +
      ];

      invalidNumbers.forEach(number => {
        const result = phoneNumberSchema.safeParse(number);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('cuidSchema', () => {
    it('should validate valid CUIDs', () => {
      const validCuids = [
        'clh1234567890abcdefghijkl',
        'cm01234567890abcdefghijk',
        'ckz1234567890abcdefghijk',
      ];

      validCuids.forEach(cuid => {
        const result = cuidSchema.safeParse(cuid);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid CUIDs', () => {
      const invalidCuids = [
        'short',
        'this-is-way-too-long-to-be-a-valid-cuid',
        'invalid_chars_@#$',
        '',
        '1234567890abcdefghijklmn', // Wrong prefix
      ];

      invalidCuids.forEach(cuid => {
        const result = cuidSchema.safeParse(cuid);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Schema Integration', () => {
    it('should validate complex nested data', () => {
      const complexData = {
        user: {
          userId: 'clh1234567890abcdefghijkl',
          phoneNumber: '+1234567890',
        },
        memory: {
          content: 'Complex memory with multiple validations',
          memoryType: 'MIXED',
          importance: 8,
          tags: ['complex', 'validation', 'test'],
        },
        pagination: {
          page: '2',
          limit: '15',
        },
      };

      // Test individual schema validations
      expect(cuidSchema.safeParse(complexData.user.userId).success).toBe(true);
      expect(phoneNumberSchema.safeParse(complexData.user.phoneNumber).success).toBe(true);
      expect(paginationSchema.safeParse(complexData.pagination).success).toBe(true);
    });

    it('should handle schema transformations', () => {
      const dataWithTransforms = {
        page: '3',
        limit: '25',
        tags: 'work,important,urgent',
      };

      const paginationResult = paginationSchema.safeParse(dataWithTransforms);
      expect(paginationResult.success).toBe(true);
      if (paginationResult.success) {
        expect(typeof paginationResult.data.page).toBe('number');
        expect(typeof paginationResult.data.limit).toBe('number');
        expect(paginationResult.data.page).toBe(3);
        expect(paginationResult.data.limit).toBe(25);
      }
    });
  });
});
