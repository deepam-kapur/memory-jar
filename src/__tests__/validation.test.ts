import { Request, Response, NextFunction } from 'express';
import { 
  validate, 
  sanitize, 
  validateTwilioSignature, 
  validateApiKey,
  validateContentSecurityPolicy,
  validatePhoneNumber,
  validateCuid 
} from '../middleware/validation';
import { z } from 'zod';
import { ValidationError, UnauthorizedError } from '../utils/errors';
import crypto from 'crypto';

// Mock environment
jest.mock('../config/environment', () => ({
  env: {
    TWILIO_AUTH_TOKEN: 'test-auth-token',
    API_KEY: 'test-api-key-12345678'
  }
}));

describe('Validation Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      body: {},
      query: {},
      params: {},
      headers: {},
    };
    mockRes = {
      setHeader: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('validate middleware', () => {
    const testSchema = z.object({
      name: z.string().min(1),
      age: z.number().min(0),
    });

    it('should pass validation with valid data', () => {
      mockReq.body = { name: 'John', age: 25 };
      
      const middleware = validate(testSchema, 'body');
      middleware(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
      expect(mockReq.body).toEqual({ name: 'John', age: 25 });
    });

    it('should fail validation with invalid data', () => {
      mockReq.body = { name: '', age: -1 };
      
      const middleware = validate(testSchema, 'body');
      middleware(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.details).toBeDefined();
    });

    it('should validate query parameters', () => {
      mockReq.query = { name: 'John', age: '25' };
      
      const middleware = validate(testSchema, 'query');
      middleware(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should validate URL parameters', () => {
      mockReq.params = { name: 'John', age: '25' };
      
      const middleware = validate(testSchema, 'params');
      middleware(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('sanitize middleware', () => {
    it('should sanitize malicious script tags', () => {
      mockReq.body = {
        content: '<script>alert("xss")</script>Hello World',
        nested: {
          value: '<iframe src="evil.com"></iframe>Test'
        }
      };
      
      sanitize(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockReq.body.content).toBe('Hello World');
      expect(mockReq.body.nested.value).toBe('Test');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should remove null bytes and control characters', () => {
      mockReq.body = {
        content: 'Hello\x00World\x01Test'
      };
      
      sanitize(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockReq.body.content).toBe('HelloWorldTest');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should remove javascript protocols', () => {
      mockReq.body = {
        url: 'javascript:alert("xss")',
        onclick: 'onclick=alert("xss")'
      };
      
      sanitize(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockReq.body.url).toBe('alert("xss")');
      expect(mockReq.body.onclick).toBe('alert("xss")');
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should handle arrays and nested objects', () => {
      mockReq.body = {
        items: ['<script>evil</script>Item1', 'Item2'],
        nested: {
          deep: {
            value: '<iframe></iframe>Clean'
          }
        }
      };
      
      sanitize(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockReq.body.items[0]).toBe('Item1');
      expect(mockReq.body.nested.deep.value).toBe('Clean');
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('validateTwilioSignature middleware', () => {
    beforeEach(() => {
      mockReq.headers = {};
      mockReq.protocol = 'https';
      mockReq.originalUrl = '/webhook';
      (mockReq as any).get = jest.fn().mockReturnValue('example.com');
      (mockReq as any).rawBody = 'test-body';
    });

    it('should pass with valid Twilio signature', () => {
      const url = 'https://example.com/webhook';
      const body = 'test-body';
      const expectedSignature = crypto
        .createHmac('sha1', 'test-auth-token')
        .update(url + body)
        .digest('base64');
      
      mockReq.headers!['x-twilio-signature'] = `sha1=${expectedSignature}`;
      
      validateTwilioSignature(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should fail with missing signature', () => {
      validateTwilioSignature(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.message).toBe('Missing Twilio signature');
    });

    it('should fail with invalid signature', () => {
      mockReq.headers!['x-twilio-signature'] = 'sha1=invalid-signature';
      
      validateTwilioSignature(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.message).toBe('Invalid Twilio signature');
    });
  });

  describe('validateApiKey middleware', () => {
    it('should pass with valid API key in header', () => {
      mockReq.headers!['x-api-key'] = 'test-api-key-12345678';
      
      validateApiKey(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should pass with valid API key in Authorization header', () => {
      mockReq.headers!['authorization'] = 'Bearer test-api-key-12345678';
      
      validateApiKey(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should fail with missing API key', () => {
      validateApiKey(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.message).toBe('API key required');
    });

    it('should fail with invalid API key', () => {
      mockReq.headers!['x-api-key'] = 'invalid-key';
      
      validateApiKey(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.message).toBe('Invalid API key');
    });
  });

  describe('validateContentSecurityPolicy middleware', () => {
    it('should set security headers', () => {
      validateContentSecurityPolicy(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Security-Policy', expect.stringContaining("default-src 'self'"));
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'strict-origin-when-cross-origin');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('validatePhoneNumber middleware', () => {
    it('should pass with valid E.164 phone number in body', () => {
      mockReq.body = { phoneNumber: '+1234567890' };
      
      validatePhoneNumber(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should pass with valid phone number in query', () => {
      mockReq.query = { phoneNumber: '+447911123456' };
      
      validatePhoneNumber(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should fail with invalid phone number format', () => {
      mockReq.body = { phoneNumber: '1234567890' }; // Missing +
      
      validatePhoneNumber(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.message).toContain('Invalid phone number format');
    });

    it('should pass when no phone number is provided', () => {
      validatePhoneNumber(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('validateCuid middleware', () => {
    it('should pass with valid CUID', () => {
      mockReq.body = { userId: 'c' + 'a'.repeat(24) };
      
      validateCuid(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should fail with invalid CUID format', () => {
      mockReq.body = { userId: 'invalid-cuid' };
      
      validateCuid(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.message).toContain('Invalid userId format');
    });

    it('should validate multiple CUID fields', () => {
      mockReq.body = { 
        userId: 'c' + 'a'.repeat(24),
        interactionId: 'c' + 'b'.repeat(24),
        memoryId: 'invalid-cuid'
      };
      
      validateCuid(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.message).toContain('Invalid memoryId format');
    });

    it('should pass when no CUID fields are provided', () => {
      mockReq.body = { name: 'test' };
      
      validateCuid(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledWith();
    });
  });
});
