import express from 'express';
import { env } from '../config/environment';
import { checkDatabaseHealth, getDatabaseStats } from '../services/database';
import { getMem0Service } from '../services/mem0Service';
import { getOpenAIService } from '../services/openaiService';
import { getLocalStorageService } from '../services/localStorageService';

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
    // Check all service health
    const [dbHealth, dbStats, mem0Health, openaiHealth, localStorageHealth] = await Promise.allSettled([
      checkDatabaseHealth(),
      getDatabaseStats(),
      Promise.resolve({ status: getMem0Service().isMemoryServiceConnected() ? 'connected' : 'disconnected' }),
      getOpenAIService().healthCheck(),
      getLocalStorageService().healthCheck(),
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
        database: dbHealth.status === 'fulfilled' ? dbHealth.value.status : 'unhealthy',
        mem0: mem0Health.status === 'fulfilled' ? mem0Health.value.status : 'unhealthy',
        openai: openaiHealth.status === 'fulfilled' ? openaiHealth.value.status : 'unhealthy',
        localStorage: localStorageHealth.status === 'fulfilled' ? localStorageHealth.value.status : 'unhealthy',
      },
      database: {
        health: dbHealth.status === 'fulfilled' ? dbHealth.value : { status: 'unhealthy', message: 'Service unavailable' },
        stats: dbStats.status === 'fulfilled' ? dbStats.value : null,
      },
      mem0: mem0Health.status === 'fulfilled' ? mem0Health.value : { status: 'unhealthy', message: 'Service unavailable' },
      openai: openaiHealth.status === 'fulfilled' ? openaiHealth.value : { status: 'unhealthy', message: 'Service unavailable' },
      localStorage: localStorageHealth.status === 'fulfilled' ? localStorageHealth.value : { status: 'unhealthy', message: 'Service unavailable' },
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
    // Check all critical service health
    const [dbHealth, mem0Health, openaiHealth, localStorageHealth] = await Promise.allSettled([
      checkDatabaseHealth(),
      Promise.resolve({ status: getMem0Service().isMemoryServiceConnected() ? 'connected' : 'disconnected' }),
      getOpenAIService().healthCheck(),
      getLocalStorageService().healthCheck(),
    ]);
    
    const isDbHealthy = dbHealth.status === 'fulfilled' && dbHealth.value.status === 'healthy';
    const isMem0Healthy = mem0Health.status === 'fulfilled' && mem0Health.value.status === 'healthy';
    const isOpenAIHealthy = openaiHealth.status === 'fulfilled' && openaiHealth.value.status === 'healthy';
    const isLocalStorageHealthy = localStorageHealth.status === 'fulfilled' && localStorageHealth.value.status === 'healthy';
    
    const isReady = isDbHealthy && isMem0Healthy && isOpenAIHealthy && isLocalStorageHealthy;
    
    if (isReady) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        services: {
          database: isDbHealthy ? 'healthy' : 'unhealthy',
          mem0: isMem0Healthy ? 'healthy' : 'unhealthy',
          openai: isOpenAIHealthy ? 'healthy' : 'unhealthy',
          localStorage: isLocalStorageHealthy ? 'healthy' : 'unhealthy',
        },
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        services: {
          database: isDbHealthy ? 'healthy' : 'unhealthy',
          mem0: isMem0Healthy ? 'healthy' : 'unhealthy',
          openai: isOpenAIHealthy ? 'healthy' : 'unhealthy',
          localStorage: isLocalStorageHealthy ? 'healthy' : 'unhealthy',
        },
        reason: 'One or more critical services are not healthy',
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
