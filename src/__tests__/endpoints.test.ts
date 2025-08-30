import request from 'supertest';
import app from '../app';
import { getDatabase } from '../services/database';

// Mock the database service
jest.mock('../services/database');
jest.mock('../services/twilioService', () => ({
  twilioService: () => ({
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    processWebhookPayload: jest.fn().mockReturnValue({
      messageSid: 'test-message-sid',
      from: 'whatsapp:+1234567890',
      to: 'whatsapp:+14155238886',
      body: 'Test message',
      messageType: 'TEXT',
      mediaFiles: [],
      timestamp: new Date(),
      accountSid: 'test-account-sid',
    }),
    sendWhatsAppMessage: jest.fn().mockResolvedValue(undefined),
  }),
}));

const mockDb = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  interaction: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
  },
  memory: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
  },
  mediaFile: {
    count: jest.fn(),
  },
};

describe('Task 2.2 Endpoints - Complete Implementation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getDatabase as jest.Mock).mockReturnValue(mockDb);
  });

  describe('POST /webhook - Twilio WhatsApp Webhook', () => {
    const webhookPayload = {
      MessageSid: 'SM1234567890',
      From: 'whatsapp:+1234567890',
      To: 'whatsapp:+14155238886',
      Body: 'Hello, this is a test message',
      NumMedia: '0',
      Timestamp: '1642234567',
      AccountSid: 'AC1234567890',
    };

    it('should process webhook and create user, interaction, and memory', async () => {
      // Mock database responses
      mockDb.user.findUnique.mockResolvedValue(null); // User doesn't exist
      mockDb.user.create.mockResolvedValue({
        id: 'user123',
        phoneNumber: '+1234567890',
        name: 'WhatsApp User (+1234567890)',
      });
      mockDb.interaction.findUnique.mockResolvedValue(null); // No existing interaction
      mockDb.interaction.create.mockResolvedValue({
        id: 'interaction123',
        userId: 'user123',
        messageSid: 'SM1234567890',
        messageType: 'TEXT',
        content: 'Hello, this is a test message',
        status: 'PENDING',
      });
      mockDb.memory.create.mockResolvedValue({
        id: 'memory123',
        userId: 'user123',
        interactionId: 'interaction123',
        content: 'Hello, this is a test message',
        memoryType: 'TEXT',
        tags: [],
        importance: 1,
        mem0Id: 'mem0_123',
      });

      const response = await request(app)
        .post('/webhook')
        .set('X-Twilio-Signature', 'valid_signature')
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        message: 'Webhook processed successfully',
        messageSid: 'SM1234567890',
        userId: 'user123',
        interactionId: 'interaction123',
        memoryId: 'memory123',
        messageType: 'TEXT',
        processingStatus: 'completed',
      });

      // Verify database calls
      expect(mockDb.user.create).toHaveBeenCalledWith({
        data: {
          phoneNumber: '+1234567890',
          name: 'WhatsApp User (+1234567890)',
          isActive: true,
        },
      });
      expect(mockDb.interaction.create).toHaveBeenCalled();
      expect(mockDb.memory.create).toHaveBeenCalled();
    });

    it('should handle duplicate webhook (idempotency)', async () => {
      const existingInteraction = {
        id: 'interaction123',
        userId: 'user123',
        messageSid: 'SM1234567890',
      };

      mockDb.interaction.findUnique.mockResolvedValue(existingInteraction);

      const response = await request(app)
        .post('/webhook')
        .set('X-Twilio-Signature', 'valid_signature')
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        message: 'Webhook already processed',
        processingStatus: 'already_processed',
      });

      // Should not create new user, interaction, or memory
      expect(mockDb.user.create).not.toHaveBeenCalled();
      expect(mockDb.interaction.create).not.toHaveBeenCalled();
      expect(mockDb.memory.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /memories - Create Memory', () => {
    const memoryPayload = {
      userId: 'user123',
      content: 'Test memory content',
      memoryType: 'TEXT',
      tags: ['test', 'important'],
      importance: 5,
    };

    it('should create memory successfully', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user123',
        phoneNumber: '+1234567890',
        name: 'Test User',
      });
      mockDb.memory.create.mockResolvedValue({
        id: 'memory123',
        ...memoryPayload,
        mem0Id: 'mem0_123',
        user: {
          id: 'user123',
          phoneNumber: '+1234567890',
          name: 'Test User',
        },
      });

      const response = await request(app)
        .post('/memories')
        .send(memoryPayload);

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        id: 'memory123',
        userId: 'user123',
        content: 'Test memory content',
        memoryType: 'TEXT',
        tags: ['test', 'important'],
        importance: 5,
      });
    });

    it('should validate user exists', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/memories')
        .send(memoryPayload);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('User not found');
    });

    it('should validate interaction belongs to user', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user123',
        phoneNumber: '+1234567890',
        name: 'Test User',
      });
      mockDb.interaction.findUnique.mockResolvedValue({
        id: 'interaction123',
        userId: 'different-user',
      });

      const response = await request(app)
        .post('/memories')
        .send({
          ...memoryPayload,
          interactionId: 'interaction123',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Interaction does not belong to user');
    });
  });

  describe('GET /memories?query=<text> - Search Memories', () => {
    it('should search memories with text query', async () => {
      const mockMemories = [
        {
          id: 'memory1',
          content: 'Meeting with team about project',
          memoryType: 'TEXT',
          tags: ['work', 'meeting'],
          importance: 5,
          user: { id: 'user123', phoneNumber: '+1234567890', name: 'Test User' },
          interaction: { id: 'interaction1', messageType: 'TEXT', content: 'Meeting with team' },
        },
      ];

      mockDb.memory.findMany.mockResolvedValue(mockMemories);
      mockDb.memory.count.mockResolvedValue(1);
      mockDb.memory.updateMany.mockResolvedValue({ count: 1 });

      const response = await request(app)
        .get('/memories?query=meeting');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].content).toContain('meeting');
      expect(response.body.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 1,
        pages: 1,
      });
      expect(response.body.search).toMatchObject({
        query: 'meeting',
        resultsCount: 1,
      });

      // Verify access count was updated
      expect(mockDb.memory.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['memory1'] } },
        data: {
          accessCount: { increment: 1 },
          lastAccessed: expect.any(Date),
        },
      });
    });

    it('should handle search with filters', async () => {
      mockDb.memory.findMany.mockResolvedValue([]);
      mockDb.memory.count.mockResolvedValue(0);

      const response = await request(app)
        .get('/memories?query=test&userId=user123&memoryType=TEXT&minImportance=3&maxImportance=8');

      expect(response.status).toBe(200);
      expect(mockDb.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            content: { contains: 'test', mode: 'insensitive' },
            userId: 'user123',
            memoryType: 'TEXT',
            importance: { gte: 3, lte: 8 },
          }),
        })
      );
    });
  });

  describe('GET /memories/list - List All Memories', () => {
    it('should list all memories with pagination', async () => {
      const mockMemories = [
        {
          id: 'memory1',
          content: 'First memory',
          memoryType: 'TEXT',
          createdAt: new Date('2024-01-15T10:00:00Z'),
          user: { id: 'user123', phoneNumber: '+1234567890', name: 'Test User' },
        },
        {
          id: 'memory2',
          content: 'Second memory',
          memoryType: 'IMAGE',
          createdAt: new Date('2024-01-15T09:00:00Z'),
          user: { id: 'user123', phoneNumber: '+1234567890', name: 'Test User' },
        },
      ];

      mockDb.memory.findMany.mockResolvedValue(mockMemories);
      mockDb.memory.count.mockResolvedValue(2);

      const response = await request(app)
        .get('/memories/list?page=1&limit=10');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
        pages: 1,
        hasNext: false,
        hasPrev: false,
      });
    });

    it('should handle filtering by user and memory type', async () => {
      mockDb.memory.findMany.mockResolvedValue([]);
      mockDb.memory.count.mockResolvedValue(0);

      const response = await request(app)
        .get('/memories/list?userId=user123&memoryType=IMAGE');

      expect(response.status).toBe(200);
      expect(mockDb.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user123',
            memoryType: 'IMAGE',
          },
        })
      );
    });
  });

  describe('GET /interactions/recent - Recent Interactions', () => {
    it('should return recent interactions with pagination', async () => {
      const mockInteractions = [
        {
          id: 'interaction1',
          messageType: 'TEXT',
          content: 'Hello',
          timestamp: new Date('2024-01-15T10:00:00Z'),
          direction: 'INBOUND',
          status: 'PROCESSED',
          user: { id: 'user123', phoneNumber: '+1234567890', name: 'Test User' },
        },
      ];

      mockDb.interaction.findMany.mockResolvedValue(mockInteractions);
      mockDb.interaction.count.mockResolvedValue(1);

      const response = await request(app)
        .get('/interactions/recent?limit=20&page=1');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].messageType).toBe('TEXT');
      expect(response.body.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 1,
        pages: 1,
      });
    });
  });

  describe('GET /analytics/summary - Analytics Summary', () => {
    it('should return comprehensive analytics', async () => {
      // Mock analytics data
      mockDb.user.count.mockResolvedValue(50);
      mockDb.interaction.count.mockResolvedValue(1000);
      mockDb.memory.count.mockResolvedValue(500);
      mockDb.mediaFile.count.mockResolvedValue(200);
      mockDb.memory.groupBy.mockResolvedValue([
        { memoryType: 'TEXT', _count: { id: 300 } },
        { memoryType: 'IMAGE', _count: { id: 150 } },
        { memoryType: 'AUDIO', _count: { id: 50 } },
      ]);
      mockDb.memory.aggregate.mockResolvedValue({
        _avg: { importance: 4.2 },
      });
      mockDb.interaction.count.mockResolvedValueOnce(150); // For recent activity
      mockDb.memory.findMany.mockResolvedValue([
        { tags: ['work', 'important'] },
        { tags: ['personal', 'work'] },
      ]);
      mockDb.interaction.findFirst.mockResolvedValue({
        timestamp: new Date('2024-01-15T10:30:00Z'),
      });

      const response = await request(app)
        .get('/analytics/summary');

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        overview: {
          totalUsers: 50,
          totalInteractions: 1000,
          totalMemories: 500,
          totalMediaFiles: 200,
          averageImportance: 4.2,
          recentActivity7Days: 150,
        },
        memoriesByType: [
          { type: 'TEXT', count: 300 },
          { type: 'IMAGE', count: 150 },
          { type: 'AUDIO', count: 50 },
        ],
        topTags: expect.arrayContaining([
          expect.objectContaining({ tag: 'work', count: expect.any(Number) }),
        ]),
        lastIngestTime: expect.any(String),
        generatedAt: expect.any(String),
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDb.user.findUnique.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/memories')
        .send({
          userId: 'user123',
          content: 'Test memory',
          memoryType: 'TEXT',
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/memories')
        .send({
          // Missing required fields
          userId: 'user123',
        });

      expect(response.status).toBe(422);
      expect(response.body.error).toBeDefined();
    });
  });
});
