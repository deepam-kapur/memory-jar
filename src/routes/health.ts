import express from 'express';
import { env } from '../config/environment';

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
router.get('/detailed', (_req, res) => {
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
      database: 'unknown', // Will be updated when database is implemented
      mem0: 'unknown', // Will be updated when Mem0 is implemented
      twilio: 'unknown', // Will be updated when Twilio is implemented
    },
  };

  res.status(200).json(healthData);
});

// Readiness check (for Kubernetes)
router.get('/ready', (_req, res) => {
  // Add checks for required services here
  const isReady = true; // Will be updated with actual service checks
  
  if (isReady) {
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  } else {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
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
