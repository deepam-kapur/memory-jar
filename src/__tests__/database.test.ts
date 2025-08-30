import { getDatabase, checkDatabaseHealth, getDatabaseStats } from '../services/database';

// Mock the Prisma client
jest.mock('../generated/prisma', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    user: {
      count: jest.fn().mockResolvedValue(5),
    },
    interaction: {
      count: jest.fn().mockResolvedValue(10),
    },
    memory: {
      count: jest.fn().mockResolvedValue(15),
    },
    mediaFile: {
      count: jest.fn().mockResolvedValue(8),
    },
    analytics: {
      count: jest.fn().mockResolvedValue(25),
    },
    $disconnect: jest.fn(),
  })),
}));

describe('Database Service', () => {
  describe('getDatabase', () => {
    it('should return a Prisma client instance', () => {
      const db = getDatabase();
      expect(db).toBeDefined();
      expect(db.$queryRaw).toBeDefined();
    });
  });

  describe('checkDatabaseHealth', () => {
    it('should return healthy status when database is accessible', async () => {
      const health = await checkDatabaseHealth();
      
      expect(health.status).toBe('healthy');
      expect(health.message).toBe('Database connection is healthy');
      expect(health.details).toBeDefined();
      expect(health.details?.userCount).toBe(5);
    });

    it('should return unhealthy status when database query fails', async () => {
      const mockDb = getDatabase();
      (mockDb.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error('Connection failed'));

      const health = await checkDatabaseHealth();
      
      expect(health.status).toBe('unhealthy');
      expect(health.message).toBe('Database connection failed');
      expect(health.details?.error).toBe('Connection failed');
    });
  });

  describe('getDatabaseStats', () => {
    it('should return database statistics', async () => {
      const stats = await getDatabaseStats();
      
      expect(stats.users).toBe(5);
      expect(stats.interactions).toBe(10);
      expect(stats.memories).toBe(15);
      expect(stats.mediaFiles).toBe(8);
      expect(stats.analytics).toBe(25);
    });
  });
});

