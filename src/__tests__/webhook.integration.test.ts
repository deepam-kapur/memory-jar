import request from 'supertest';
import app from '../app';
import { getDatabase } from '../services/database';
import { getTwilioService } from '../services/twilioService';
import { getMultimodalService } from '../services/multimodalService';
import { getTimezoneService } from '../services/timezoneService';

// Mock all services
jest.mock('../services/database');
jest.mock('../services/twilioService');
jest.mock('../services/multimodalService');
jest.mock('../services/timezoneService');

const mockDb = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  interaction: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  memory: {
    create: jest.fn(),
  },
};

const mockTwilioService = {
  processWebhookPayload: jest.fn(),
  sendWhatsAppMessage: jest.fn(),
  getMessageType: jest.fn(),
  extractMediaInfo: jest.fn(),
};

const mockMultimodalService = {
  processWhatsAppMessage: jest.fn(),
  searchMemories: jest.fn(),
};

const mockTimezoneService = {
  detectTimezoneFromPhoneNumber: jest.fn(),
  updateUserTimezone: jest.fn(),
};

(getDatabase as jest.Mock).mockReturnValue(mockDb);
(getTwilioService as jest.Mock).mockReturnValue(mockTwilioService);
(getMultimodalService as jest.Mock).mockReturnValue(mockMultimodalService);
(getTimezoneService as jest.Mock).mockReturnValue(mockTimezoneService);

describe('Webhook Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementations
    mockTwilioService.processWebhookPayload.mockImplementation((payload) => ({
      MessageSid: payload.MessageSid || 'SM123456789',
      From: payload.From || 'whatsapp:+1234567890',
      To: payload.To || 'whatsapp:+14155238886',
      Body: payload.Body || 'Test message',
      NumMedia: payload.NumMedia || '0',
    }));
    
    mockTimezoneService.detectTimezoneFromPhoneNumber.mockReturnValue('America/New_York');
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.create.mockResolvedValue({
      id: 'user123',
      phoneNumber: '+1234567890',
      timezone: 'America/New_York',
    });
    mockDb.interaction.findUnique.mockResolvedValue(null);
  });

  describe('POST /webhook', () => {
    const validWebhookPayload = {
      MessageSid: 'SM123456789',
      From: 'whatsapp:+1234567890',
      To: 'whatsapp:+14155238886',
      Body: 'Hello, this is a test message',
      NumMedia: '0',
    };

    it('should process new text message successfully', async () => {
      // Mock successful memory processing
      mockMultimodalService.processWhatsAppMessage.mockResolvedValue({
        id: 'mem123',
        content: 'Hello, this is a test message',
        memoryType: 'TEXT',
        mediaFiles: [],
        metadata: { source: 'whatsapp' },
        userId: 'user123',
      });

      mockDb.interaction.create.mockResolvedValue({
        id: 'interaction123',
        userId: 'user123',
        messageSid: 'SM123456789',
        messageType: 'TEXT',
        content: 'Hello, this is a test message',
      });

      mockDb.memory.create.mockResolvedValue({
        id: 'memory123',
        userId: 'user123',
        interactionId: 'interaction123',
        content: 'Hello, this is a test message',
        memoryType: 'TEXT',
      });

      const response = await request(app)
        .post('/webhook')
        .send(validWebhookPayload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Memory created successfully');
      expect(response.body.userId).toBe('user123');
      expect(response.body.memoryId).toBe('memory123');
      expect(response.body.processingStatus).toBe('new_memory');

      // Verify service calls
      expect(mockTwilioService.processWebhookPayload).toHaveBeenCalledWith(validWebhookPayload);
      expect(mockDb.user.create).toHaveBeenCalled();
      expect(mockMultimodalService.processWhatsAppMessage).toHaveBeenCalled();
      expect(mockDb.memory.create).toHaveBeenCalled();
      expect(mockTwilioService.sendWhatsAppMessage).toHaveBeenCalled();
    });

    it('should handle query messages and search memories', async () => {
      const queryPayload = {
        ...validWebhookPayload,
        Body: 'What did I plan for dinner?',
      };

      // Mock existing user
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user123',
        phoneNumber: '+1234567890',
        timezone: 'America/New_York',
      });

      mockMultimodalService.searchMemories.mockResolvedValue([
        {
          id: 'mem123',
          content: 'Plan to cook pasta for dinner',
          metadata: { timestamp: new Date().toISOString() },
        },
      ]);

      mockDb.interaction.create.mockResolvedValue({
        id: 'interaction123',
        userId: 'user123',
        messageSid: 'SM123456789',
        messageType: 'TEXT',
        content: 'What did I plan for dinner?',
      });

      const response = await request(app)
        .post('/webhook')
        .send(queryPayload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Query processed successfully');
      expect(response.body.processingStatus).toBe('query');
      expect(response.body.resultsCount).toBe(1);

      // Verify search was called
      expect(mockMultimodalService.searchMemories).toHaveBeenCalledWith(
        'What did I plan for dinner?',
        'user123',
        5
      );
    });

    it('should handle idempotent requests', async () => {
      // Mock existing interaction
      mockDb.interaction.findUnique.mockResolvedValue({
        id: 'existing-interaction',
        userId: 'user123',
        messageSid: 'SM123456789',
        memories: [{ id: 'existing-memory' }],
      });

      const response = await request(app)
        .post('/webhook')
        .send(validWebhookPayload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Message already processed');
      expect(response.body.processingStatus).toBe('duplicate');
      expect(response.body.interactionId).toBe('existing-interaction');

      // Verify no new processing occurred
      expect(mockMultimodalService.processWhatsAppMessage).not.toHaveBeenCalled();
      expect(mockDb.memory.create).not.toHaveBeenCalled();
    });

    it('should create new user with timezone detection', async () => {
      const response = await request(app)
        .post('/webhook')
        .send(validWebhookPayload);

      expect(mockTimezoneService.detectTimezoneFromPhoneNumber).toHaveBeenCalledWith('+1234567890');
      expect(mockDb.user.create).toHaveBeenCalledWith({
        data: {
          phoneNumber: '+1234567890',
          timezone: 'America/New_York',
        },
      });
    });

    it('should update existing user timezone if using default', async () => {
      // Mock existing user with UTC timezone
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user123',
        phoneNumber: '+1234567890',
        timezone: 'UTC',
      });

      mockTimezoneService.detectTimezoneFromPhoneNumber.mockReturnValue('America/New_York');

      const response = await request(app)
        .post('/webhook')
        .send(validWebhookPayload);

      expect(mockTimezoneService.updateUserTimezone).toHaveBeenCalledWith('user123', 'America/New_York');
    });

    it('should handle validation errors', async () => {
      const invalidPayload = {
        // Missing required MessageSid
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+14155238886',
      };

      const response = await request(app)
        .post('/webhook')
        .send(invalidPayload);

      expect(response.status).toBe(422);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toBeDefined();
    });

    it('should handle service errors gracefully', async () => {
      mockMultimodalService.processWhatsAppMessage.mockRejectedValue(new Error('Processing failed'));

      const response = await request(app)
        .post('/webhook')
        .send(validWebhookPayload);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Internal server error');
    });

    it('should handle media messages', async () => {
      const mediaPayload = {
        ...validWebhookPayload,
        Body: 'Check out this photo',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/123',
        MediaContentType0: 'image/jpeg',
      };

      mockMultimodalService.processWhatsAppMessage.mockResolvedValue({
        id: 'mem123',
        content: 'Check out this photo',
        memoryType: 'IMAGE',
        mediaFiles: ['https://storage.com/image123.jpg'],
        metadata: { source: 'whatsapp', mediaType: 'image/jpeg' },
        userId: 'user123',
      });

      mockDb.interaction.create.mockResolvedValue({
        id: 'interaction123',
        userId: 'user123',
        messageSid: 'SM123456789',
        messageType: 'IMAGE',
        content: 'Check out this photo',
      });

      mockDb.memory.create.mockResolvedValue({
        id: 'memory123',
        userId: 'user123',
        interactionId: 'interaction123',
        content: 'Check out this photo',
        memoryType: 'IMAGE',
      });

      const response = await request(app)
        .post('/webhook')
        .send(mediaPayload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.memoryType).toBe('IMAGE');
    });

    it('should handle rate limiting', async () => {
      // Make multiple rapid requests to trigger rate limiting
      const requests = Array(10).fill(null).map(() =>
        request(app).post('/webhook').send(validWebhookPayload)
      );

      const responses = await Promise.all(requests);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('Webhook Security', () => {
    it('should validate Twilio signature when provided', async () => {
      // This test would require proper signature generation
      // For now, we'll test that the middleware is applied
      const response = await request(app)
        .post('/webhook')
        .set('X-Twilio-Signature', 'invalid-signature')
        .send({
          MessageSid: 'SM123456789',
          From: 'whatsapp:+1234567890',
          To: 'whatsapp:+14155238886',
          Body: 'Test message',
        });

      // Should fail signature validation
      expect(response.status).toBe(401);
    });

    it('should sanitize input data', async () => {
      const maliciousPayload = {
        MessageSid: 'SM123456789',
        From: 'whatsapp:+1234567890',
        To: 'whatsapp:+14155238886',
        Body: '<script>alert("xss")</script>Hello World',
        NumMedia: '0',
      };

      // Mock to capture sanitized data
      mockTwilioService.processWebhookPayload.mockImplementation((payload) => {
        expect(payload.Body).toBe('Hello World'); // Script tag should be removed
        return {
          MessageSid: payload.MessageSid,
          From: payload.From,
          To: payload.To,
          Body: payload.Body,
          NumMedia: payload.NumMedia,
        };
      });

      const response = await request(app)
        .post('/webhook')
        .send(maliciousPayload);

      // Should process successfully with sanitized data
      expect(mockTwilioService.processWebhookPayload).toHaveBeenCalled();
    });
  });
});
