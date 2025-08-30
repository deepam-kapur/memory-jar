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
      const querySchema = z.object({ page: z.coerce.number().min(1) });
      mockReq.query = { page: '1' };

      validate(querySchema, 'query')(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockReq.query).toEqual({ page: 1 });
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

    it('should handle arrays', () => {
      mockReq.body = {
        tags: ['  tag1  ', '  tag2<script>alert("xss")</script>  '],
      };

      sanitize(mockReq, mockRes, mockNext);

      expect(mockReq.body.tags).toEqual(['tag1', 'tag2']);
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
      validatePhoneNumber(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
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
      validateCuid(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
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
    it('should allow requests within limit', () => {
      apiLimiter(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle rate limit exceeded', () => {
      // Mock the rate limit being exceeded
      mockReq.rateLimit = {
        remaining: 0,
        limit: 100,
        resetTime: Date.now() + 60000,
      };

      apiLimiter(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Too many requests'),
        })
      );
    });
  });

  describe('searchLimiter', () => {
    it('should allow search requests within limit', () => {
      searchLimiter(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('suspiciousActivityLimiter', () => {
    it('should allow normal requests', () => {
      suspiciousActivityLimiter(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
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
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('errorHandler', () => {
    it('should handle ValidationError', () => {
      const error = new ValidationError('Validation failed', { field: ['Invalid'] });

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(422);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: { field: ['Invalid'] },
        })
      );
    });

    it('should handle NotFoundError', () => {
      const error = new NotFoundError('Resource not found');

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Resource not found',
          code: 'RESOURCE_NOT_FOUND',
        })
      );
    });

    it('should handle RateLimitError', () => {
      const error = new RateLimitError('Rate limit exceeded');

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
        })
      );
    });

    it('should handle generic errors', () => {
      const error = new Error('Generic error');

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'An unexpected error occurred',
          code: 'INTERNAL_ERROR',
        })
      );
    });

    it('should include stack trace in development', () => {
      process.env.NODE_ENV = 'development';
      const error = new Error('Test error');

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: expect.any(String),
        })
      );
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
