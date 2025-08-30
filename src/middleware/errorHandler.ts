import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma';
import { 
  AppError, 
  ValidationError, 
  BadRequestError, 
  NotFoundError, 
  InternalServerError,
  RateLimitError,
  DatabaseError,
  ExternalServiceError,
  ErrorCodes 
} from '../utils/errors';
import logger from '../config/logger';
import { env } from '../config/environment';

// Enhanced error handler middleware
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response
) => {
  let appError: AppError;

  // Log the error
  logger.error('Error occurred', {
    error: error.message,
    stack: error.stack,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: (req as any).id,
  });

  // Handle different types of errors
  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof ZodError) {
    // Handle Zod validation errors
    const details: Record<string, string[]> = {};
    
    (error as any).errors.forEach((err: any) => {
      const field = err.path.join('.');
      if (!details[field]) {
        details[field] = [];
      }
      details[field].push(err.message);
    });

    appError = new ValidationError('Validation failed', details, ErrorCodes.INVALID_INPUT);
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Handle Prisma database errors
    switch (error.code) {
      case 'P2002':
        appError = new BadRequestError(
          'Resource already exists',
          ErrorCodes.RESOURCE_ALREADY_EXISTS
        );
        break;
      case 'P2025':
        appError = new NotFoundError(
          'Resource not found',
          ErrorCodes.RESOURCE_NOT_FOUND
        );
        break;
      case 'P2003':
        appError = new BadRequestError(
          'Invalid foreign key reference',
          ErrorCodes.INVALID_INPUT
        );
        break;
      default:
        appError = new DatabaseError(
          'Database operation failed',
          ErrorCodes.DATABASE_QUERY_ERROR
        );
    }
  } else if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    appError = new DatabaseError(
      'Unknown database error',
      ErrorCodes.DATABASE_QUERY_ERROR
    );
  } else if (error instanceof Prisma.PrismaClientValidationError) {
    appError = new ValidationError(
      'Database validation error',
      undefined,
      ErrorCodes.INVALID_INPUT
    );
  } else if (error.message === 'Rate limit exceeded') {
    appError = new RateLimitError(
      'Rate limit exceeded',
      ErrorCodes.RATE_LIMIT_EXCEEDED
    );
  } else if (error.message.includes('ECONNREFUSED')) {
    appError = new ExternalServiceError(
      'Database',
      'Connection refused',
      ErrorCodes.DATABASE_CONNECTION_ERROR
    );
  } else if (error.message.includes('ETIMEDOUT')) {
    appError = new ExternalServiceError(
      'Database',
      'Connection timeout',
      ErrorCodes.DATABASE_CONNECTION_ERROR
    );
  } else {
    // Default to internal server error
    appError = new InternalServerError(
      'An unexpected error occurred',
      ErrorCodes.INTERNAL_ERROR
    );
  }

  // Prepare error response
  const errorResponse: any = {
    error: appError.message,
    code: appError.code || 'UNKNOWN_ERROR',
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method,
    requestId: (req as any).id,
  };

  // Add validation details if available
  if (appError instanceof ValidationError && appError.details) {
    errorResponse.details = appError.details;
  }

  // Add stack trace in development
  if (env.NODE_ENV === 'development') {
    errorResponse.stack = error.stack;
  }

  // Set appropriate status code
  const statusCode = appError.statusCode || 500;

  // Send error response
  res.status(statusCode).json(errorResponse);
};

// 404 handler for unmatched routes
export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  const error = new NotFoundError(
    `Route ${req.originalUrl} not found`,
    ErrorCodes.RESOURCE_NOT_FOUND
  );
  next(error);
};

// Async error wrapper for route handlers
export const asyncHandler = (fn: Function) => {
  return (req: any, res: any, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Request timeout handler
export const timeoutHandler = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        const error = new ExternalServiceError(
          'Request',
          'Request timeout',
          'REQUEST_TIMEOUT'
        );
        next(error);
      }
    }, timeoutMs);

    res.on('finish', () => {
      clearTimeout(timeout);
    });

    next();
  };
};

// Security error handler
export const securityErrorHandler = (error: Error, req: Request, res: Response) => {
  // Log security-related errors with additional context
  logger.warn('Security error detected', {
    error: error.message,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    requestId: (req as any).id,
  });

  // Don't expose internal details for security errors
  const securityError = new BadRequestError(
    'Invalid request',
    ErrorCodes.INVALID_INPUT
  );

  res.status(securityError.statusCode).json({
    error: securityError.message,
    code: securityError.code,
    timestamp: new Date().toISOString(),
  });
};
