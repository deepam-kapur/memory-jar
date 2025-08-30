import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isDevelopment } from './config/environment';
import { initializeDatabase, closeDatabase } from './services/database';

// Import routes (will be created later)
import healthRoutes from './routes/health';

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

// Request logging
app.use(morgan(isDevelopment ? 'dev' : 'combined'));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request ID middleware for tracking
app.use((req, _res, next) => {
  req.id = Math.random().toString(36).substring(7);
  next();
});

// Routes
app.use('/health', healthRoutes);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    message: 'Memory Jar API',
    version: '1.0.0',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// 404 handler - catch all unmatched routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    timestamp: new Date().toISOString(),
  });
});

// Global error handler
app.use((error: Error, _req: express.Request, res: express.Response) => {
  console.error('Unhandled error:', error);
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: isDevelopment ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString(),
    ...(isDevelopment && { stack: error.stack }),
  });
});

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
