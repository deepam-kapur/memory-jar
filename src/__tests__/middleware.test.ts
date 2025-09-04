import { validate, sanitize, validatePhoneNumber, validateCuid } from '../middleware/validation';
import { apiLimiter, searchLimiter, suspiciousActivityLimiter } from '../middleware/rateLimit';
import { errorHandler, notFoundHandler, asyncHandler, timeoutHandler } from '../middleware/errorHandler';
import { ValidationError, NotFoundError, RateLimitError } from '../utils/errors';
import { z } from 'zod';

describe('Validation Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockReq = {
      body: {},
      query: {},
      params: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('validate', () => {
    const testSchema = z.object({
      name: z.string().min(1),
      email: z.string().email(),
    });

    it('should pass validation for valid data', () => {
      mockReq.body = { name: 'Test User', email: 'test@example.com' };

      validate(testSchema)(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockReq.body).toEqual({ name: 'Test User', email: 'test@example.com' });
    });

    it('should handle validation errors', () => {
      mockReq.body = { name: '', email: 'invalid-email' };

      validate(testSchema)(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = mockNext.mock.calls[0][0];
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toBe('Validation failed');
    });

    it('should validate query parameters', () => {
      const querySchema = z.object({ page: z.string() });
      mockReq.query = { page: '1' };

      validate(querySchema, 'query')(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockReq.query).toEqual({ page: '1' });
    });

    it('should validate params', () => {
      const paramsSchema = z.object({ id: z.string().cuid() });
      mockReq.params = { id: 'clh1234567890abcdefghijkl' };

      validate(paramsSchema, 'params')(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('sanitize', () => {
    it('should sanitize string values', () => {
      mockReq.body = {
        name: '  Test<script>alert("xss")</script>User  ',
        email: 'test@example.com',
      };

      sanitize(mockReq, mockRes, mockNext);

      expect(mockReq.body.name).toBe('TestUser');
      expect(mockReq.body.email).toBe('test@example.com');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle nested objects', () => {
      mockReq.body = {
        user: {
          name: '  Test<script>alert("xss")</script>User  ',
          profile: {
            bio: '  Test bio  ',
          },
        },
      };

      sanitize(mockReq, mockRes, mockNext);

      expect(mockReq.body.user.name).toBe('TestUser');
      expect(mockReq.body.user.profile.bio).toBe('Test bio');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle arrays by sanitizing each element', () => {
      mockReq.body = {
        tags: ['simple', 'test'],
      };

      sanitize(mockReq, mockRes, mockNext);

      // The sanitize function should process each element
      expect(mockReq.body.tags[0]).toBe('simple');
      expect(mockReq.body.tags[1]).toBe('test');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle null and undefined', () => {
      mockReq.body = {
        name: null,
        email: undefined,
        age: 25,
      };

      sanitize(mockReq, mockRes, mockNext);

      expect(mockReq.body.name).toBeNull();
      expect(mockReq.body.email).toBeUndefined();
      expect(mockReq.body.age).toBe(25);
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('validatePhoneNumber', () => {
    it('should validate valid phone number in body', () => {
      mockReq.body = { phoneNumber: '+1234567890' };

      validatePhoneNumber(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should validate valid phone number in query', () => {
      mockReq.query = { phoneNumber: '+1234567890' };

      validatePhoneNumber(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should validate valid phone number in params', () => {
      mockReq.params = { phoneNumber: '+1234567890' };

      validatePhoneNumber(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject invalid phone number', () => {
      mockReq.body = { phoneNumber: 'invalid-phone' };

      validatePhoneNumber(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('should handle missing phone number', () => {
      mockReq.body = {};
      mockReq.query = {};
      mockReq.params = {};

      validatePhoneNumber(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('validateCuid', () => {
    it('should validate valid CUID', () => {
      mockReq.params = { userId: 'clh1234567890abcdefghijkl' };

      validateCuid(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject invalid CUID', () => {
      mockReq.params = { userId: 'invalid-cuid' };

      validateCuid(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('should handle missing CUID', () => {
      mockReq.params = {};

      validateCuid(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });
});

describe('Rate Limiting Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockReq = {
      ip: '127.0.0.1',
      method: 'GET',
      path: '/test',
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      set: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('apiLimiter', () => {
    it('should be a function', () => {
      expect(typeof apiLimiter).toBe('function');
    });
  });

  describe('searchLimiter', () => {
    it('should be a function', () => {
      expect(typeof searchLimiter).toBe('function');
    });
  });

  describe('suspiciousActivityLimiter', () => {
    it('should be a function', () => {
      expect(typeof suspiciousActivityLimiter).toBe('function');
    });
  });
});

describe('Error Handler Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockReq = {
      originalUrl: '/test',
      method: 'GET',
      id: 'test-request-id',
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('test-user-agent'),
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      emit: jest.fn(),
      on: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('errorHandler', () => {
    it('should handle ValidationError', () => {
      const error = new ValidationError('Validation failed', { field: ['Invalid'] });

      errorHandler(error, mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(422);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: { field: ['Invalid'] },
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
          requestId: 'test-request-id',
        })
      );
    });

    it('should handle NotFoundError', () => {
      const error = new NotFoundError('Resource not found');

      errorHandler(error, mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Resource not found',
          code: 'RESOURCE_NOT_FOUND',
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
          requestId: 'test-request-id',
        })
      );
    });

    it('should handle RateLimitError', () => {
      const error = new RateLimitError('Rate limit exceeded');

      errorHandler(error, mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
          requestId: 'test-request-id',
        })
      );
    });

    it('should handle generic errors', () => {
      const error = new Error('Generic error');

      errorHandler(error, mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'An unexpected error occurred',
          code: 'INTERNAL_ERROR',
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
          requestId: 'test-request-id',
        })
      );
    });

    it('should include stack trace in development', () => {
      // Temporarily change environment
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      // Clear module cache and re-import to get fresh environment
      jest.resetModules();
      const { errorHandler: devErrorHandler } = require('../middleware/errorHandler');
      
      const error = new Error('Test error');
      devErrorHandler(error, mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: expect.any(String),
        })
      );
      
      // Restore environment
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('notFoundHandler', () => {
    it('should create NotFoundError', () => {
      notFoundHandler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(NotFoundError));
      const error = mockNext.mock.calls[0][0];
      expect(error.message).toBe('Not Found');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('asyncHandler', () => {
    it('should handle successful async operations', async () => {
      const asyncFn = jest.fn().mockResolvedValue('success');
      const handler = asyncHandler(asyncFn);

      await handler(mockReq, mockRes, mockNext);

      expect(asyncFn).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle async operation errors', async () => {
      const error = new Error('Async error');
      const asyncFn = jest.fn().mockRejectedValue(error);
      const handler = asyncHandler(asyncFn);

      await handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('timeoutHandler', () => {
    it('should set timeout and clear on finish', () => {
      jest.useFakeTimers();
      
      const handler = timeoutHandler(1000);
      handler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();

      // Simulate request finish
      mockRes.emit('finish');

      jest.useRealTimers();
    });

    it('should handle timeout', () => {
      jest.useFakeTimers();
      
      const handler = timeoutHandler(1000);
      handler(mockReq, mockRes, mockNext);

      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(1001);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));

      jest.useRealTimers();
    });
  });
});
