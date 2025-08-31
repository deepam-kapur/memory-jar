import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isDevelopment } from './config/environment';
import { initializeDatabase, closeDatabase } from './services/database';

// Import middleware
import { requestLogger, errorLogger } from './config/logger';
import { sanitize } from './middleware/validation';
import { suspiciousActivityLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler, timeoutHandler } from './middleware/errorHandler';

// Import routes
import healthRoutes from './routes/health';
import webhookRoutes from './routes/webhook';
import memoryRoutes from './routes/memories';
import interactionRoutes from './routes/interactions';
import analyticsRoutes from './routes/analytics';
import mediaRoutes from './routes/media';

// Create Express application
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: isDevelopment ? ['http://localhost:3000', 'http://localhost:3001'] : [],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Request timeout handler
app.use(timeoutHandler(30000)); // 30 seconds

// Request logging
app.use(morgan(isDevelopment ? 'dev' : 'combined'));
app.use(requestLogger);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request ID middleware for tracking
app.use((req, _res, next) => {
  req.id = Math.random().toString(36).substring(7);
  next();
});

// Input sanitization
app.use(sanitize);

// Rate limiting
app.use(suspiciousActivityLimiter);

// Routes
  app.use('/health', healthRoutes);
  app.use('/webhook', webhookRoutes);
  app.use('/memories', memoryRoutes);
  app.use('/interactions', interactionRoutes);
  app.use('/analytics', analyticsRoutes);
  app.use('/media', mediaRoutes);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    message: 'WhatsApp Memory Assistant API',
    version: '1.0.0',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    description: 'WhatsApp chatbot using Twilio and Mem0 for memory management',
    endpoints: {
      health: '/health',
      webhook: '/webhook (POST) - Twilio WhatsApp webhook',
      memories: '/memories (POST/GET) - Multimodal memory management',
      memoriesList: '/memories/list (GET) - List all memories from DB',
      interactions: '/interactions/recent (GET) - Recent interactions',
      analytics: '/analytics/summary (GET) - Database analytics',
    },
  });
});

// 404 handler - catch all unmatched routes
app.use(notFoundHandler);

// Error logging middleware
app.use(errorLogger);

// Global error handler
app.use(errorHandler);

// Graceful shutdown handling
const gracefulShutdown = (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  server.close(async () => {
    console.log('✅ HTTP server closed');
    
    // Close database connection
    await closeDatabase();
    
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Start server
const server = app.listen(env.PORT, env.HOST, async () => {
  // Initialize database
  try {
    initializeDatabase();
    // eslint-disable-next-line no-console
    console.log('✅ Database initialized');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ Failed to initialize database:', error);
  }

  // eslint-disable-next-line no-console
  console.log(`🚀 Memory Jar server running on http://${env.HOST}:${env.PORT}`);
  // eslint-disable-next-line no-console
  console.log(`📊 Environment: ${env.NODE_ENV}`);
  // eslint-disable-next-line no-console
  console.log(`🔧 Node version: ${process.version}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export default app;
