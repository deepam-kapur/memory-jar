import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Environment schema validation
const envSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default(3000),
  HOST: z.string().default('localhost'),

  // Database Configuration
  DATABASE_URL: z.string().default('postgresql://username:password@localhost:5432/memory_jar'),

  // Twilio Configuration
  TWILIO_ACCOUNT_SID: z.string().default('your_twilio_account_sid'),
  TWILIO_AUTH_TOKEN: z.string().default('your_twilio_auth_token'),
  TWILIO_WHATSAPP_NUMBER: z.string().default('whatsapp:+14155238886'),

  // Mem0 Configuration
  MEM0_API_KEY: z.string().default('your_mem0_api_key'),
  MEM0_BASE_URL: z.string().url().default('https://api.mem0.ai'),

  // Local Storage Configuration
  STORAGE_DIR: z.string().default('storage/media'),

  // OpenAI Configuration
  OPENAI_API_KEY: z.string().default('your_openai_api_key'),

  // Logging Configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FILE: z.string().default('logs/app.log'),

  // Security Configuration
  JWT_SECRET: z.string().default('your_jwt_secret_32_characters_long_for_development'),
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default(100),
});

// Validate and parse environment variables
const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
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

// Export validated environment configuration
export const env = parseEnv();

// Environment type for TypeScript
export type Environment = z.infer<typeof envSchema>;

// Helper functions
export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isStaging = env.NODE_ENV === 'staging';
