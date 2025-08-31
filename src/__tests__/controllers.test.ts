import { Request, Response } from 'express';
import { handleIncomingMessage } from '../controllers/webhookController';
import { getDatabase } from '../services/database';
import { getTwilioService } from '../services/twilioService';
import { getMultimodalService } from '../services/multimodalService';

// Mock the services
jest.mock('../services/database');
jest.mock('../services/twilioService');
jest.mock('../services/multimodalService');

describe('Webhook Controller', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockDb: any;
  let mockTwilioService: any;
  let mockMultimodalService: any;

  beforeEach(() => {
    mockReq = {
      body: {
        MessageSid: 'test-message-sid',
        From: 'whatsapp:+1234567890',
        Body: 'Test message',
        NumMedia: '0'
      }
    };

    mockRes = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis()
    };

    mockDb = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn()
      },
      interaction: {
        findUnique: jest.fn(),
        create: jest.fn()
      },
      memory: {
        create: jest.fn()
      }
    };

    mockTwilioService = {
      processWebhookPayload: jest.fn(),
      sendWhatsAppMessage: jest.fn()
    };

    mockMultimodalService = {
      processWhatsAppMessage: jest.fn(),
      searchMemories: jest.fn()
    };

    (getDatabase as jest.Mock).mockReturnValue(mockDb);
    (getTwilioService as jest.Mock).mockReturnValue(mockTwilioService);
    (getMultimodalService as jest.Mock).mockReturnValue(mockMultimodalService);
  });

  describe('handleIncomingMessage', () => {
    it('should process webhook and create user, interaction, and memory', async () => {
      // Mock service responses
      mockTwilioService.processWebhookPayload.mockReturnValue({
        MessageSid: 'test-message-sid',
        From: 'whatsapp:+1234567890',
        Body: 'Test message',
        NumMedia: '0'
      });

      mockDb.user.findUnique.mockResolvedValue(null);
      mockDb.user.create.mockResolvedValue({ id: 'user123' });
      mockDb.interaction.findUnique.mockResolvedValue(null);
      mockDb.interaction.create.mockResolvedValue({ id: 'interaction123' });
      mockDb.memory.create.mockResolvedValue({ id: 'memory123' });

      mockMultimodalService.processWhatsAppMessage.mockResolvedValue({
        id: 'mem0-memory-123',
        content: 'Test message',
        memoryType: 'TEXT',
        mediaFiles: [],
        metadata: { tags: [], importance: 1 },
        userId: 'user123'
      });

      mockTwilioService.sendWhatsAppMessage.mockResolvedValue(undefined);

      await handleIncomingMessage(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Memory created successfully',
          userId: 'user123',
          interactionId: 'interaction123',
          memoryId: 'memory123'
        })
      );
    });

    it('should handle duplicate webhook (idempotency)', async () => {
      // Mock existing interaction
      mockDb.user.findUnique.mockResolvedValue({ id: 'user123' });
      mockDb.interaction.findUnique.mockResolvedValue({
        id: 'existing-interaction',
        memories: [{ id: 'existing-memory' }]
      });

      mockTwilioService.processWebhookPayload.mockReturnValue({
        MessageSid: 'test-message-sid',
        From: 'whatsapp:+1234567890',
        Body: 'Test message',
        NumMedia: '0'
      });

      await handleIncomingMessage(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Message already processed',
          processingStatus: 'duplicate'
        })
      );
    });

    it('should handle query messages', async () => {
      // Mock query message
      mockReq.body = {
        MessageSid: 'test-message-sid',
        From: 'whatsapp:+1234567890',
        Body: 'What did I say about dinner?',
        NumMedia: '0'
      };

      mockTwilioService.processWebhookPayload.mockReturnValue({
        MessageSid: 'test-message-sid',
        From: 'whatsapp:+1234567890',
        Body: 'What did I say about dinner?',
        NumMedia: '0'
      });

      mockDb.user.findUnique.mockResolvedValue({ id: 'user123' });
      mockDb.interaction.findUnique.mockResolvedValue(null);
      mockDb.interaction.create.mockResolvedValue({ id: 'interaction123' });

      mockMultimodalService.searchMemories.mockResolvedValue([
        {
          id: 'memory123',
          content: 'Remember to buy dinner ingredients',
          metadata: { timestamp: new Date().toISOString() }
        }
      ]);

      mockTwilioService.sendWhatsAppMessage.mockResolvedValue(undefined);

      await handleIncomingMessage(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Query processed successfully',
          processingStatus: 'query'
        })
      );
    });
  });
});
