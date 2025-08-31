import request from 'supertest';
import app from '../app';
import { getDatabase } from '../services/database';

// Mock database for performance testing
jest.mock('../services/database');
const mockDb = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  interaction: {
    findUnique: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
  memory: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  mediaFile: {
    count: jest.fn(),
  },
  analytics: {
    createMany: jest.fn(),
    count: jest.fn(),
  },
};

(getDatabase as jest.Mock).mockReturnValue(mockDb);

describe('Performance Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks for performance testing
    mockDb.user.count.mockResolvedValue(100);
    mockDb.interaction.count.mockResolvedValue(1000);
    mockDb.memory.count.mockResolvedValue(500);
    mockDb.mediaFile.count.mockResolvedValue(200);
    mockDb.analytics.count.mockResolvedValue(2000);
    mockDb.memory.aggregate.mockResolvedValue({ _avg: { importance: 5.5 } });
    mockDb.memory.findMany.mockResolvedValue([]);
    mockDb.interaction.findMany.mockResolvedValue([]);
  });

  describe('API Response Times', () => {
    it('should respond to health check within 100ms', async () => {
      const startTime = Date.now();
      
      const response = await request(app).get('/health');
      
      const responseTime = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(100);
    });

    it('should respond to analytics summary within 500ms', async () => {
      const startTime = Date.now();
      
      const response = await request(app).get('/analytics/summary');
      
      const responseTime = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(500);
    });

    it('should respond to memory list within 300ms', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/memories/list')
        .query({ page: 1, limit: 20 });
      
      const responseTime = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(300);
    });

    it('should respond to recent interactions within 200ms', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/interactions/recent')
        .query({ limit: 10 });
      
      const responseTime = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(200);
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle 10 concurrent health checks', async () => {
      const requests = Array(10).fill(null).map(() =>
        request(app).get('/health')
      );
      
      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      
      // Should complete within reasonable time (not much slower than single request)
      expect(totalTime).toBeLessThan(500);
    });

    it('should handle 5 concurrent analytics requests', async () => {
      const requests = Array(5).fill(null).map(() =>
        request(app).get('/analytics/summary')
      );
      
      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      
      expect(totalTime).toBeLessThan(1000);
    });

    it('should handle mixed concurrent requests', async () => {
      const requests = [
        request(app).get('/health'),
        request(app).get('/analytics/summary'),
        request(app).get('/memories/list?limit=10'),
        request(app).get('/interactions/recent?limit=5'),
        request(app).get('/health'),
      ];
      
      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
      
      expect(totalTime).toBeLessThan(1000);
    });
  });

  describe('Memory Usage Tests', () => {
    it('should not leak memory during repeated requests', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Make 50 requests
      for (let i = 0; i < 50; i++) {
        await request(app).get('/health');
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable (less than 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });

    it('should handle large response payloads efficiently', async () => {
      // Mock large dataset
      const largeMemoryList = Array(1000).fill(null).map((_, index) => ({
        id: `memory_${index}`,
        content: `Memory content ${index}`.repeat(10),
        memoryType: 'TEXT',
        createdAt: new Date(),
        user: { id: 'user1', phoneNumber: '+1234567890' },
        interaction: { id: `interaction_${index}`, messageType: 'TEXT' },
      }));
      
      mockDb.memory.findMany.mockResolvedValue(largeMemoryList);
      mockDb.memory.count.mockResolvedValue(1000);
      
      const startTime = Date.now();
      const response = await request(app)
        .get('/memories/list')
        .query({ page: 1, limit: 1000 });
      
      const responseTime = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1000);
      expect(responseTime).toBeLessThan(1000); // Should handle large payloads within 1 second
    });
  });

  describe('Database Query Performance', () => {
    it('should execute analytics queries efficiently', async () => {
      let queryCount = 0;
      
      // Count database queries
      const originalFindMany = mockDb.memory.findMany;
      const originalCount = mockDb.memory.count;
      const originalAggregate = mockDb.memory.aggregate;
      
      mockDb.memory.findMany.mockImplementation((...args) => {
        queryCount++;
        return originalFindMany(...args);
      });
      
      mockDb.memory.count.mockImplementation((...args) => {
        queryCount++;
        return originalCount(...args);
      });
      
      mockDb.memory.aggregate.mockImplementation((...args) => {
        queryCount++;
        return originalAggregate(...args);
      });
      
      await request(app).get('/analytics/summary');
      
      // Should not make excessive database queries
      expect(queryCount).toBeLessThan(20);
    });

    it('should use pagination effectively', async () => {
      const response = await request(app)
        .get('/memories/list')
        .query({ page: 2, limit: 50 });
      
      expect(response.status).toBe(200);
      
      // Verify pagination parameters were used
      expect(mockDb.memory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 50, // (page - 1) * limit
          take: 50,
        })
      );
    });
  });

  describe('Rate Limiting Performance', () => {
    it('should handle rate limiting efficiently', async () => {
      // Make requests up to the rate limit
      const requests = Array(20).fill(null).map(() =>
        request(app).get('/memories/list?limit=1')
      );
      
      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;
      
      // Most requests should succeed
      const successfulRequests = responses.filter(res => res.status === 200);
      expect(successfulRequests.length).toBeGreaterThan(10);
      
      // Rate limiting should not significantly slow down valid requests
      expect(totalTime).toBeLessThan(2000);
    });

    it('should handle burst traffic gracefully', async () => {
      // Simulate burst traffic
      const burstRequests = Array(100).fill(null).map((_, index) =>
        request(app)
          .get('/health')
          .set('X-Request-ID', `burst-${index}`)
      );
      
      const startTime = Date.now();
      const responses = await Promise.allSettled(burstRequests);
      const totalTime = Date.now() - startTime;
      
      // Should handle burst without crashing
      const successfulRequests = responses.filter(
        (result): result is PromiseFulfilledResult<any> => 
          result.status === 'fulfilled' && result.value.status === 200
      );
      
      expect(successfulRequests.length).toBeGreaterThan(50);
      expect(totalTime).toBeLessThan(5000);
    });
  });

  describe('Error Handling Performance', () => {
    it('should handle errors quickly without blocking other requests', async () => {
      // Mock database error
      mockDb.memory.findMany.mockRejectedValueOnce(new Error('Database error'));
      
      const errorRequest = request(app).get('/memories/list');
      const healthRequest = request(app).get('/health');
      
      const startTime = Date.now();
      const [errorResponse, healthResponse] = await Promise.all([
        errorRequest,
        healthRequest
      ]);
      const totalTime = Date.now() - startTime;
      
      // Error should be handled quickly
      expect(errorResponse.status).toBe(500);
      expect(healthResponse.status).toBe(200);
      expect(totalTime).toBeLessThan(500);
    });
  });
});
