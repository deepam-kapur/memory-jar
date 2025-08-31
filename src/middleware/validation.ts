import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { ValidationError, UnauthorizedError } from '../utils/errors';
import crypto from 'crypto';
import { env } from '../config/environment';

// Validation middleware factory
export const validate = (schema: z.ZodSchema, location: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const data = req[location];
      const validatedData = schema.parse(data);
      
      // Replace the original data with validated data (only for body)
      if (location === 'body') {
        req[location] = validatedData;
      }
      
      // For query and params, we just validate but don't replace (they're read-only)
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details: Record<string, string[]> = {};
        
        // Handle both old and new Zod error structures
        const errors = (error as any).errors || error.issues || [];
        
        errors.forEach((err: any) => {
          const field = err.path ? err.path.join('.') : err.path || 'unknown';
          if (!details[field]) {
            details[field] = [];
          }
          details[field].push(err.message || 'Validation failed');
        });

        const validationError = new ValidationError(
          'Validation failed',
          details,
          'VALIDATION_ERROR'
        );
        
        next(validationError);
      } else {
        next(error);
      }
    }
  };
};

// Sanitize middleware to clean input data
export const sanitize = (req: Request, _res: Response, next: NextFunction) => {
  // Sanitize body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  
  // Note: req.query and req.params are read-only in Express
  // They are automatically sanitized by Express itself
  // We only need to sanitize the body
  
  next();
};

// Helper function to sanitize objects recursively
const sanitizeObject = (obj: any): any => {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  
  const sanitized: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Remove null bytes and other potentially dangerous characters
      // Also remove script tags and other XSS vectors
      sanitized[key] = value
        .replace(/\0/g, '') // Remove null bytes
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '') // Remove iframe tags
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+\s*=/gi, '') // Remove event handlers
        .trim();
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
};

// Rate limiting validation
export const validateRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const rateLimitInfo = (req as any).rateLimit;
  
  if (rateLimitInfo && rateLimitInfo.remaining === 0) {
    const retryAfter = Math.ceil(rateLimitInfo.resetTime / 1000);
    
    res.set('Retry-After', retryAfter.toString());
    res.set('X-RateLimit-Limit', rateLimitInfo.limit.toString());
    res.set('X-RateLimit-Remaining', rateLimitInfo.remaining.toString());
    res.set('X-RateLimit-Reset', rateLimitInfo.resetTime.toString());
    
    next(new Error('Rate limit exceeded'));
  } else {
    next();
  }
};

// File upload validation
export const validateFileUpload = (req: Request, _res: Response, next: NextFunction) => {
  const file = (req as any).file;
  
  if (!file) {
    return next(new ValidationError('No file uploaded', undefined, 'MISSING_FILE'));
  }
  
  // Check file size (default 10MB)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    return next(new ValidationError('File too large', undefined, 'FILE_TOO_LARGE'));
  }
  
  // Check file type
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/ogg',
    'video/mp4',
    'video/webm',
    'video/ogg',
    'application/pdf',
    'text/plain',
  ];
  
  if (!allowedTypes.includes(file.mimetype)) {
    return next(new ValidationError('Invalid file type', undefined, 'INVALID_FILE_TYPE'));
  }
  
  next();
};

// Phone number validation middleware
export const validatePhoneNumber = (req: Request, _res: Response, next: NextFunction) => {
  const phoneNumber = req.body['phoneNumber'] || req.query['phoneNumber'] || req.params['phoneNumber'];
  
  if (phoneNumber) {
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return next(new ValidationError(
        'Invalid phone number format. Must be in E.164 format (e.g., +1234567890)',
        undefined,
        'INVALID_PHONE_NUMBER'
      ));
    }
  }
  
  next();
};

// CUID validation middleware
export const validateCuid = (req: Request, _res: Response, next: NextFunction) => {
  const cuidFields = ['userId', 'interactionId', 'memoryId', 'mediaFileId'];
  
  for (const field of cuidFields) {
    const value = req.body[field] || req.query[field] || req.params[field];
    
    if (value) {
      const cuidRegex = /^c[a-z0-9]{24}$/;
      if (!cuidRegex.test(value)) {
        return next(new ValidationError(
          `Invalid ${field} format`,
          undefined,
          'INVALID_CUID'
        ));
      }
    }
  }
  
  next();
};

// Twilio webhook signature validation
export const validateTwilioSignature = (req: Request, _res: Response, next: NextFunction) => {
  const twilioSignature = req.headers['x-twilio-signature'] as string;
  
  if (!twilioSignature) {
    return next(new UnauthorizedError('Missing Twilio signature', 'MISSING_SIGNATURE'));
  }
  
  // Get the raw body for signature validation
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  
  // Create the expected signature
  const expectedSignature = crypto
    .createHmac('sha1', env.TWILIO_AUTH_TOKEN)
    .update(url + rawBody)
    .digest('base64');
  
  const expectedSignatureHeader = `sha1=${expectedSignature}`;
  
  // Compare signatures using timing-safe comparison
  if (!crypto.timingSafeEqual(
    Buffer.from(twilioSignature),
    Buffer.from(expectedSignatureHeader)
  )) {
    return next(new UnauthorizedError('Invalid Twilio signature', 'INVALID_SIGNATURE'));
  }
  
  next();
};

// API key validation middleware
export const validateApiKey = (req: Request, _res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;
  const authHeader = req.headers['authorization'] as string;
  
  // Check for API key in header or Authorization bearer token
  let providedKey = apiKey;
  if (!providedKey && authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.substring(7);
  }
  
  if (!providedKey) {
    return next(new UnauthorizedError('API key required', 'MISSING_API_KEY'));
  }
  
  // In production, this would validate against a database of API keys
  // For now, we'll use a simple environment variable
  const validApiKey = env.API_KEY || 'development-api-key';
  
  if (providedKey !== validApiKey) {
    return next(new UnauthorizedError('Invalid API key', 'INVALID_API_KEY'));
  }
  
  next();
};

// Content Security Policy validation
export const validateContentSecurityPolicy = (req: Request, res: Response, next: NextFunction) => {
  // Set CSP headers
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));
  
  // Additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  next();
};
