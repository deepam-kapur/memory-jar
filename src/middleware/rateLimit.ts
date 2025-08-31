import rateLimit from 'express-rate-limit';
import { env } from '../config/environment';
import { Request, Response, NextFunction } from 'express';

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000),
      timestamp: new Date().toISOString(),
    });
  },
});

// Strict rate limiter for authentication endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: {
    error: 'Too many authentication attempts',
    message: 'Too many authentication attempts. Please try again later.',
    code: 'AUTH_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Too many authentication attempts. Please try again later.',
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      retryAfter: 900, // 15 minutes
      timestamp: new Date().toISOString(),
    });
  },
});

// File upload rate limiter
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 uploads per hour
  message: {
    error: 'Too many file uploads',
    message: 'File upload limit exceeded. Please try again later.',
    code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many file uploads',
      message: 'File upload limit exceeded. Please try again later.',
      code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
      retryAfter: 3600, // 1 hour
      timestamp: new Date().toISOString(),
    });
  },
});

// WhatsApp webhook rate limiter (more permissive)
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 webhook calls per minute
  message: {
    error: 'Too many webhook requests',
    message: 'Webhook rate limit exceeded.',
    code: 'WEBHOOK_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many webhook requests',
      message: 'Webhook rate limit exceeded.',
      code: 'WEBHOOK_RATE_LIMIT_EXCEEDED',
      retryAfter: 60, // 1 minute
      timestamp: new Date().toISOString(),
    });
  },
});

// Search rate limiter
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 searches per minute
  message: {
    error: 'Too many search requests',
    message: 'Search rate limit exceeded. Please try again later.',
    code: 'SEARCH_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many search requests',
      message: 'Search rate limit exceeded. Please try again later.',
      code: 'SEARCH_RATE_LIMIT_EXCEEDED',
      retryAfter: 60, // 1 minute
      timestamp: new Date().toISOString(),
    });
  },
});

// Chat rate limiter
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 chat messages per minute
  message: {
    error: 'Too many chat messages',
    message: 'Chat rate limit exceeded. Please try again later.',
    code: 'CHAT_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many chat messages',
      message: 'Chat rate limit exceeded. Please try again later.',
      code: 'CHAT_RATE_LIMIT_EXCEEDED',
      retryAfter: 60, // 1 minute
      timestamp: new Date().toISOString(),
    });
  },
});

// IP-based rate limiter for suspicious activity
export const suspiciousActivityLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 requests per 5 minutes
  message: {
    error: 'Suspicious activity detected',
    message: 'Too many requests from this IP. Please try again later.',
    code: 'SUSPICIOUS_ACTIVITY',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Suspicious activity detected',
      message: 'Too many requests from this IP. Please try again later.',
      code: 'SUSPICIOUS_ACTIVITY',
      retryAfter: 300, // 5 minutes
      timestamp: new Date().toISOString(),
    });
  },
  skip: (req) => {
    // Skip rate limiting for health checks and certain trusted IPs
    return req.path.startsWith('/health') || 
           req.ip === '127.0.0.1' || 
           req.ip === '::1' ||
           req.ip === 'localhost';
  },
});

// Per-user rate limiting using in-memory store
const userRateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of userRateLimitStore.entries()) {
    if (now > value.resetTime) {
      userRateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Per-user rate limiter middleware
export const createUserRateLimiter = (maxRequests: number, windowMs: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Extract user identifier from request
    const userId = req.body?.userId || req.query?.userId || req.params?.userId;
    const phoneNumber = req.body?.From?.replace('whatsapp:', '') || req.headers['x-user-phone'];
    
    const userKey = userId || phoneNumber || req.ip;
    const now = Date.now();
    
    // Get or create user rate limit entry
    let userLimit = userRateLimitStore.get(userKey);
    
    if (!userLimit || now > userLimit.resetTime) {
      // Reset or create new entry
      userLimit = {
        count: 1,
        resetTime: now + windowMs
      };
      userRateLimitStore.set(userKey, userLimit);
      return next();
    }
    
    // Check if user has exceeded limit
    if (userLimit.count >= maxRequests) {
      const retryAfter = Math.ceil((userLimit.resetTime - now) / 1000);
      
      res.set('Retry-After', retryAfter.toString());
      res.set('X-RateLimit-Limit', maxRequests.toString());
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', userLimit.resetTime.toString());
      
      return res.status(429).json({
        error: 'User rate limit exceeded',
        message: `Too many requests from user. Please try again in ${retryAfter} seconds.`,
        code: 'USER_RATE_LIMIT_EXCEEDED',
        retryAfter,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Increment counter
    userLimit.count++;
    userRateLimitStore.set(userKey, userLimit);
    
    // Set rate limit headers
    res.set('X-RateLimit-Limit', maxRequests.toString());
    res.set('X-RateLimit-Remaining', (maxRequests - userLimit.count).toString());
    res.set('X-RateLimit-Reset', userLimit.resetTime.toString());
    
    next();
  };
};

// User-specific rate limiters
export const userApiLimiter = createUserRateLimiter(50, 15 * 60 * 1000); // 50 requests per 15 minutes per user
export const userSearchLimiter = createUserRateLimiter(20, 60 * 1000); // 20 searches per minute per user
export const userMemoryLimiter = createUserRateLimiter(30, 60 * 1000); // 30 memory operations per minute per user
