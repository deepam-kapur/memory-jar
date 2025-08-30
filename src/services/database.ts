import { PrismaClient } from '../generated/prisma';
import { env } from '../config/environment';

// Global Prisma client instance
let prisma: PrismaClient;

// Initialize Prisma client with connection pooling
export const initializeDatabase = (): PrismaClient => {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: env.DATABASE_URL,
        },
      },
      log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }

  return prisma;
};

// Get database client instance
export const getDatabase = (): PrismaClient => {
  if (!prisma) {
    return initializeDatabase();
  }
  return prisma;
};

// Database health check
export const checkDatabaseHealth = async (): Promise<{
  status: 'healthy' | 'unhealthy';
  message: string;
  details?: any;
}> => {
  try {
    const db = getDatabase();
    
    // Test connection with a simple query
    await db.$queryRaw`SELECT 1`;
    
    // Check if we can access the database
    const userCount = await db.user.count();
    
    return {
      status: 'healthy',
      message: 'Database connection is healthy',
      details: {
        userCount,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: 'Database connection failed',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
    };
  }
};

// Transaction wrapper for database operations
export const withTransaction = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  const db = getDatabase();
  
  return db.$transaction(async () => {
    return operation();
  });
};

// Graceful database shutdown
export const closeDatabase = async (): Promise<void> => {
  if (prisma) {
    await prisma.$disconnect();
    console.log('✅ Database connection closed');
  }
};

// Database statistics
export const getDatabaseStats = async (): Promise<{
  users: number;
  interactions: number;
  memories: number;
  mediaFiles: number;
  analytics: number;
}> => {
  const db = getDatabase();
  
  const [users, interactions, memories, mediaFiles, analytics] = await Promise.all([
    db.user.count(),
    db.interaction.count(),
    db.memory.count(),
    db.mediaFile.count(),
    db.analytics.count(),
  ]);

  return {
    users,
    interactions,
    memories,
    mediaFiles,
    analytics,
  };
};

// Export the Prisma client types
export type { PrismaClient } from '../generated/prisma';
