import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Environment schema validation with production-ready requirements
const envSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default(3000),
  HOST: z.string().default('localhost'),

  // Database Configuration - Required in production
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Twilio Configuration - Required for WhatsApp functionality
  TWILIO_ACCOUNT_SID: z.string().min(1, 'TWILIO_ACCOUNT_SID is required'),
  TWILIO_AUTH_TOKEN: z.string().min(1, 'TWILIO_AUTH_TOKEN is required'),
  TWILIO_WHATSAPP_NUMBER: z.string().min(1, 'TWILIO_WHATSAPP_NUMBER is required'),

  // Mem0 Configuration - Optional (now using npm package instead of API)
  MEM0_API_KEY: z.string().optional(), // Legacy - no longer required
  MEM0_BASE_URL: z.string().url().default('https://api.mem0.ai').optional(),

  // Local Storage Configuration
  STORAGE_DIR: z.string().default('storage/media'),

  // OpenAI Configuration - Required for audio transcription
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),

  // Logging Configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FILE: z.string().default('logs/app.log'),

  // Security Configuration - Required in production
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  API_KEY: z.string().min(16, 'API_KEY must be at least 16 characters long').optional(),
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default(100),

  // CORS Configuration for production
  CORS_ORIGIN: z.string().optional(),
  
  // Health Check Configuration
  HEALTH_CHECK_INTERVAL: z.string().transform(Number).default(30000),
  HEALTH_CHECK_TIMEOUT: z.string().transform(Number).default(5000),
  
  // Twilio Signature Validation Configuration
  TWILIO_SIGNATURE_VALIDATION_ENABLED: z.string().transform(val => val === 'true').default(true),
  TWILIO_SIGNATURE_DEBUG: z.string().transform(val => val === 'true').default(false),
});

// Validate and parse environment variables
const parseEnv = () => {
  try {
    const parsed = envSchema.parse(process.env);
    
    // Additional production-specific validations
    if (parsed.NODE_ENV === 'production') {
      validateProductionEnvironment(parsed);
    }
    
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid environment variables:');
      if ((error as any).errors && Array.isArray((error as any).errors)) {
        (error as any).errors.forEach((err: any) => {
          console.error(`  ${err.path.join('.')}: ${err.message}`);
        });
      }
      // Don't exit in test environment
      if (process.env['NODE_ENV'] !== 'test') {
        process.exit(1);
      }
    }
    throw error;
  }
};

// Production environment validation
const validateProductionEnvironment = (env: any) => {
  const errors: string[] = [];
  
  // Validate database URL is not using default values
  if (env.DATABASE_URL.includes('username:password@localhost')) {
    errors.push('DATABASE_URL must not use default credentials in production');
  }
  
  // Validate Twilio credentials are not defaults
  if (env.TWILIO_ACCOUNT_SID === 'your_twilio_account_sid' || 
      env.TWILIO_AUTH_TOKEN === 'your_twilio_auth_token') {
    errors.push('Twilio credentials must be set to real values in production');
  }
  
  // Validate API keys are not defaults (MEM0_API_KEY is now optional)
  if (env.MEM0_API_KEY && env.MEM0_API_KEY === 'your_mem0_api_key') {
    console.warn('⚠️  MEM0_API_KEY is set to default value (now using npm package instead of API)');
  }
  
  if (env.OPENAI_API_KEY === 'your_openai_api_key') {
    errors.push('OPENAI_API_KEY must be set to real value in production');
  }
  
  // Validate JWT secret is not default
  if (env.JWT_SECRET.includes('development')) {
    errors.push('JWT_SECRET must be changed from development default in production');
  }
  
  // Validate HOST is not localhost in production
  if (env.HOST === 'localhost') {
    errors.push('HOST should not be localhost in production (use 0.0.0.0 or specific IP)');
  }
  
  // Validate LOG_LEVEL is appropriate for production
  if (env.LOG_LEVEL === 'debug') {
    console.warn('⚠️  Warning: LOG_LEVEL is set to debug in production, consider using warn or error');
  }
  
  if (errors.length > 0) {
    console.error('❌ Production environment validation failed:');
    errors.forEach(error => console.error(`  ${error}`));
    process.exit(1);
  }
  
  console.log('✅ Production environment validation passed');
};

// Export validated environment configuration
export const env = parseEnv();

// Environment type for TypeScript
export type Environment = z.infer<typeof envSchema>;

// Helper functions
export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isStaging = env.NODE_ENV === 'staging';
