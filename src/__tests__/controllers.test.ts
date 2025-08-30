import { MemoryController } from '../controllers/memoryController';
import { WebhookController } from '../controllers/webhookController';
import { InteractionController } from '../controllers/interactionController';
import { AnalyticsController } from '../controllers/analyticsController';
import { getDatabase } from '../services/database';
import { NotFoundError, BadRequestError } from '../utils/errors';

// Mock the database service
jest.mock('../services/database');
const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

describe('MemoryController', () => {
  let mockDb: any;
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockDb = {
      user: {
        findUnique: jest.fn(),
      },
      memory: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
      },
      interaction: {
        findUnique: jest.fn(),
      },
    };

    mockGetDatabase.mockReturnValue(mockDb);

    mockReq = {
      query: {},
      params: {},
      body: {},
      id: 'test-request-id',
    };

    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  describe('createMemory', () => {
    it('should create memory successfully', async () => {
      const user = { id: 'user1', phoneNumber: '+1234567890', name: 'User 1' };
      const memoryData = {
        userId: 'user1',
        content: 'Test memory content',
        memoryType: 'TEXT',
        importance: 5,
      };
      const createdMemory = { id: 'memory1', ...memoryData };

      mockDb.user.findUnique.mockResolvedValue(user);
      mockDb.memory.create.mockResolvedValue(createdMemory);

      mockReq.body = memoryData;

      await MemoryController.createMemory(mockReq, mockRes);

      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user1' },
      });
      expect(mockDb.memory.create).toHaveBeenCalledWith({
        data: memoryData,
        include: expect.any(Object),
      });
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ data: createdMemory });
    });

    it('should throw NotFoundError when user not found', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);

      mockReq.body = {
        userId: 'nonexistent',
        content: 'Test memory content',
        memoryType: 'TEXT',
        importance: 5,
      };

      await expect(MemoryController.createMemory(mockReq, mockRes)).rejects.toThrow(NotFoundError);
    });
  });

  describe('searchMemories', () => {
    it('should search memories and return results', async () => {
      const memories = [
        { id: 'memory1', content: 'Test memory 1', memoryType: 'TEXT' },
        { id: 'memory2', content: 'Test memory 2', memoryType: 'TEXT' },
      ];

      mockDb.memory.findMany.mockResolvedValue(memories);
      mockDb.memory.count.mockResolvedValue(2);

      mockReq.query = { query: 'test', page: '1', limit: '10' };

      await MemoryController.searchMemories(mockReq, mockRes);

      expect(mockDb.memory.findMany).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        data: memories,
        pagination: expect.any(Object),
        search: {
          query: 'test',
          resultsCount: 2,
        },
      });
    });
  });

  describe('listAllMemories', () => {
    it('should return all memories with pagination', async () => {
      const memories = [
        { id: 'memory1', content: 'Memory 1', memoryType: 'TEXT' },
        { id: 'memory2', content: 'Memory 2', memoryType: 'TEXT' },
      ];

      mockDb.memory.findMany.mockResolvedValue(memories);
      mockDb.memory.count.mockResolvedValue(2);

      mockReq.query = { page: '1', limit: '10' };

      await MemoryController.listAllMemories(mockReq, mockRes);

      expect(mockDb.memory.findMany).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        data: memories,
        pagination: expect.any(Object),
      });
    });
  });
});

describe('WebhookController', () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockReq = {
      body: {},
      id: 'test-request-id',
    };

    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  describe('handleIncomingMessage', () => {
    it('should handle incoming WhatsApp message', async () => {
      const webhookData = {
        MessageSid: 'test-message-sid',
        From: '+1234567890',
        To: '+0987654321',
        Body: 'Hello, this is a test message',
      };

      mockReq.body = webhookData;

      await WebhookController.handleIncomingMessage(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Webhook received successfully',
        messageSid: 'test-message-sid',
        processingStatus: 'pending_implementation',
      });
    });
  });
});

describe('InteractionController', () => {
  let mockDb: any;
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockDb = {
      interaction: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    mockGetDatabase.mockReturnValue(mockDb);

    mockReq = {
      query: {},
      id: 'test-request-id',
    };

    mockRes = {
      json: jest.fn(),
    };
  });

  describe('getRecentInteractions', () => {
    it('should return recent interactions with pagination', async () => {
      const interactions = [
        { id: 'interaction1', content: 'Hello', messageType: 'TEXT' },
        { id: 'interaction2', content: 'World', messageType: 'TEXT' },
      ];

      mockDb.interaction.findMany.mockResolvedValue(interactions);
      mockDb.interaction.count.mockResolvedValue(2);

      mockReq.query = { page: '1', limit: '10' };

      await InteractionController.getRecentInteractions(mockReq, mockRes);

      expect(mockDb.interaction.findMany).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        data: interactions,
        pagination: expect.any(Object),
      });
    });
  });
});

describe('AnalyticsController', () => {
  let mockDb: any;
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockDb = {
      user: {
        count: jest.fn(),
      },
      interaction: {
        count: jest.fn(),
        findFirst: jest.fn(),
      },
      memory: {
        count: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
        findMany: jest.fn(),
      },
      mediaFile: {
        count: jest.fn(),
      },
    };

    mockGetDatabase.mockReturnValue(mockDb);

    mockReq = {
      id: 'test-request-id',
    };

    mockRes = {
      json: jest.fn(),
    };
  });

  describe('getAnalyticsSummary', () => {
    it('should return analytics summary', async () => {
      mockDb.user.count.mockResolvedValue(5);
      mockDb.interaction.count.mockResolvedValue(100);
      mockDb.memory.count.mockResolvedValue(50);
      mockDb.mediaFile.count.mockResolvedValue(25);
      mockDb.memory.groupBy.mockResolvedValue([
        { memoryType: 'TEXT', _count: { id: 30 } },
        { memoryType: 'IMAGE', _count: { id: 20 } },
      ]);
      mockDb.memory.aggregate.mockResolvedValue({ _avg: { importance: 7 } });
      mockDb.interaction.count.mockResolvedValue(10); // recent activity
      mockDb.memory.findMany.mockResolvedValue([]); // memories with tags
      mockDb.interaction.findFirst.mockResolvedValue({ timestamp: new Date() });

      await AnalyticsController.getAnalyticsSummary(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        data: expect.objectContaining({
          overview: expect.any(Object),
          memoriesByType: expect.any(Array),
          topTags: expect.any(Array),
        }),
      });
    });
  });
});
