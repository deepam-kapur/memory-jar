import express from 'express';
import { env } from '../config/environment';
import { checkDatabaseHealth, getDatabaseStats } from '../services/database';

const router = express.Router();

// Basic health check
router.get('/', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
    version: '1.0.0',
  });
});

// Detailed health check
router.get('/detailed', async (_req, res) => {
  try {
    const [dbHealth, dbStats] = await Promise.all([
      checkDatabaseHealth(),
      getDatabaseStats(),
    ]);

    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: env.NODE_ENV,
      version: '1.0.0',
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024),
        },
        cpu: process.cpuUsage(),
      },
      services: {
        database: dbHealth.status,
        mem0: 'unknown', // Will be updated when Mem0 is implemented
        twilio: 'unknown', // Will be updated when Twilio is implemented
      },
      database: {
        health: dbHealth,
        stats: dbStats,
      },
    };

    res.status(200).json(healthData);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to get detailed health information',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Readiness check (for Kubernetes)
router.get('/ready', async (_req, res) => {
  try {
    // Check database health
    const dbHealth = await checkDatabaseHealth();
    
    const isReady = dbHealth.status === 'healthy';
    
    if (isReady) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealth.status,
        },
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealth.status,
        },
        reason: 'Database is not healthy',
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      reason: 'Failed to check service health',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Liveness check (for Kubernetes)
router.get('/live', (_req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;
