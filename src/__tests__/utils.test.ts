import {
  BaseError,
  ValidationError,
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  InternalServerError,
  ErrorCodes,
} from '../utils/errors';

describe('Error Classes', () => {
  describe('BaseError', () => {
    it('should create base error with default values', () => {
      const error = new BaseError('Test error');

      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.name).toBe('BaseError');
      expect(error.isOperational).toBe(true);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should create base error with custom values', () => {
      const error = new BaseError('Custom error', 400, 'CUSTOM_CODE');

      expect(error.message).toBe('Custom error');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('CUSTOM_CODE');
    });

    it('should capture stack trace', () => {
      const error = new BaseError('Test error');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('BaseError');
    });
  });

  describe('ValidationError', () => {
    it('should create validation error with details', () => {
      const details = {
        field1: ['Field1 is required'],
        field2: ['Field2 must be a string'],
      };
      const error = new ValidationError('Validation failed', details);

      expect(error.message).toBe('Validation failed');
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual(details);
      expect(error.name).toBe('ValidationError');
    });

    it('should create validation error without details', () => {
      const error = new ValidationError('Simple validation error');

      expect(error.message).toBe('Simple validation error');
      expect(error.details).toBeUndefined();
    });

    it('should include field count in error details', () => {
      const details = {
        field1: ['Error 1'],
        field2: ['Error 2'],
        field3: ['Error 3'],
      };
      const error = new ValidationError('Multiple field errors', details);

      expect(error.details).toEqual(details);
      expect(Object.keys(error.details!).length).toBe(3);
    });
  });

  describe('NotFoundError', () => {
    it('should create not found error', () => {
      const error = new NotFoundError('Resource not found');

      expect(error.message).toBe('Resource not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('RESOURCE_NOT_FOUND');
      expect(error.name).toBe('NotFoundError');
    });

    it('should create not found error with resource type', () => {
      const error = new NotFoundError('User not found', 'USER');

      expect(error.message).toBe('User not found');
      expect(error.code).toBe('USER');
    });
  });

  describe('BadRequestError', () => {
    it('should create bad request error', () => {
      const error = new BadRequestError('Invalid input');

      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.name).toBe('BadRequestError');
    });

    it('should create bad request error with custom code', () => {
      const error = new BadRequestError('Invalid data format', 'INVALID_FORMAT');

      expect(error.message).toBe('Invalid data format');
      expect(error.code).toBe('INVALID_FORMAT');
    });
  });

  describe('UnauthorizedError', () => {
    it('should create unauthorized error', () => {
      const error = new UnauthorizedError('Authentication required');

      expect(error.message).toBe('Authentication required');
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
      expect(error.name).toBe('UnauthorizedError');
    });

    it('should create unauthorized error with auth scheme', () => {
      const error = new UnauthorizedError('Token expired', 'TOKEN_EXPIRED');

      expect(error.message).toBe('Token expired');
      expect(error.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('ForbiddenError', () => {
    it('should create forbidden error', () => {
      const error = new ForbiddenError('Access denied');

      expect(error.message).toBe('Access denied');
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
      expect(error.name).toBe('ForbiddenError');
    });

    it('should create forbidden error with permission', () => {
      const error = new ForbiddenError('Insufficient permissions', 'INSUFFICIENT_PERMISSIONS');

      expect(error.message).toBe('Insufficient permissions');
      expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  describe('ConflictError', () => {
    it('should create conflict error', () => {
      const error = new ConflictError('Resource already exists');

      expect(error.message).toBe('Resource already exists');
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('CONFLICT');
      expect(error.name).toBe('ConflictError');
    });

    it('should create conflict error with resource type', () => {
      const error = new ConflictError('User already exists', 'USER_EXISTS');

      expect(error.message).toBe('User already exists');
      expect(error.code).toBe('USER_EXISTS');
    });
  });

  describe('RateLimitError', () => {
    it('should create rate limit error', () => {
      const error = new RateLimitError('Too many requests');

      expect(error.message).toBe('Too many requests');
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(error.name).toBe('RateLimitError');
    });

    it('should create rate limit error with retry info', () => {
      const error = new RateLimitError('Rate limit exceeded', 'RATE_LIMIT_HOURLY');

      expect(error.message).toBe('Rate limit exceeded');
      expect(error.code).toBe('RATE_LIMIT_HOURLY');
    });
  });

  describe('InternalServerError', () => {
    it('should create internal server error', () => {
      const error = new InternalServerError('Something went wrong');

      expect(error.message).toBe('Something went wrong');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.name).toBe('InternalServerError');
    });

    it('should create internal server error with context', () => {
      const error = new InternalServerError('Database connection failed', 'DATABASE_ERROR');

      expect(error.message).toBe('Database connection failed');
      expect(error.code).toBe('DATABASE_ERROR');
    });
  });

  describe('ErrorCodes', () => {
    it('should export all error codes', () => {
      expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ErrorCodes.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND');
      expect(ErrorCodes.BAD_REQUEST).toBe('BAD_REQUEST');
      expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
      expect(ErrorCodes.FORBIDDEN).toBe('FORBIDDEN');
      expect(ErrorCodes.CONFLICT).toBe('CONFLICT');
      expect(ErrorCodes.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
      expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    });

    it('should have specific error codes', () => {
      expect(ErrorCodes.INVALID_INPUT).toBe('INVALID_INPUT');
      expect(ErrorCodes.INVALID_FILE_TYPE).toBe('INVALID_FILE_TYPE');
      expect(ErrorCodes.FILE_TOO_LARGE).toBe('FILE_TOO_LARGE');
      expect(ErrorCodes.FILE_UPLOAD_ERROR).toBe('FILE_UPLOAD_ERROR');
      expect(ErrorCodes.TWILIO_ERROR).toBe('TWILIO_ERROR');
      expect(ErrorCodes.OPENAI_ERROR).toBe('OPENAI_ERROR');
      expect(ErrorCodes.MEM0_ERROR).toBe('MEM0_ERROR');
      expect(ErrorCodes.DATABASE_ERROR).toBe('DATABASE_ERROR');
    });
  });

  describe('Error Inheritance', () => {
    it('should properly inherit from Error', () => {
      const validationError = new ValidationError('Test');
      const notFoundError = new NotFoundError('Test');
      const badRequestError = new BadRequestError('Test');

      expect(validationError instanceof Error).toBe(true);
      expect(validationError instanceof BaseError).toBe(true);
      expect(validationError instanceof ValidationError).toBe(true);

      expect(notFoundError instanceof Error).toBe(true);
      expect(notFoundError instanceof BaseError).toBe(true);
      expect(notFoundError instanceof NotFoundError).toBe(true);

      expect(badRequestError instanceof Error).toBe(true);
      expect(badRequestError instanceof BaseError).toBe(true);
      expect(badRequestError instanceof BadRequestError).toBe(true);
    });

    it('should have correct prototype chain', () => {
      const error = new ValidationError('Test');

      expect(Object.getPrototypeOf(error)).toBe(ValidationError.prototype);
      expect(Object.getPrototypeOf(ValidationError.prototype)).toBe(BaseError.prototype);
      expect(Object.getPrototypeOf(BaseError.prototype)).toBe(Error.prototype);
    });
  });

  describe('Error Serialization', () => {
    it('should serialize validation error with details', () => {
      const details = { field1: ['Required'], field2: ['Invalid'] };
      const error = new ValidationError('Validation failed', details);

      const serialized = JSON.parse(JSON.stringify(error));

      expect(serialized.message).toBe('Validation failed');
      expect(serialized.statusCode).toBe(422);
      expect(serialized.code).toBe('VALIDATION_ERROR');
      expect(serialized.details).toEqual(details);
      expect(serialized.timestamp).toBeDefined();
    });

    it('should serialize basic error properties', () => {
      const error = new NotFoundError('User not found');

      const serialized = JSON.parse(JSON.stringify(error));

      expect(serialized.message).toBe('User not found');
      expect(serialized.statusCode).toBe(404);
      expect(serialized.code).toBe('RESOURCE_NOT_FOUND');
      expect(serialized.name).toBe('NotFoundError');
      expect(serialized.isOperational).toBe(true);
    });
  });

  describe('Error Comparison', () => {
    it('should compare errors by type and message', () => {
      const error1 = new ValidationError('Field required');
      const error2 = new ValidationError('Field required');
      const error3 = new ValidationError('Different message');
      const error4 = new NotFoundError('Field required');

      expect(error1.message).toBe(error2.message);
      expect(error1.statusCode).toBe(error2.statusCode);
      expect(error1.code).toBe(error2.code);

      expect(error1.message).not.toBe(error3.message);
      expect(error1.statusCode).not.toBe(error4.statusCode);
    });
  });

  describe('Error Context', () => {
    it('should maintain error context through call stack', () => {
      function throwValidationError() {
        throw new ValidationError('Inner validation error');
      }

      function wrapperFunction() {
        try {
          throwValidationError();
        } catch (error) {
          if (error instanceof ValidationError) {
            throw new BadRequestError('Wrapped error: ' + error.message);
          }
          throw error;
        }
      }

      expect(() => wrapperFunction()).toThrow(BadRequestError);
      expect(() => wrapperFunction()).toThrow('Wrapped error: Inner validation error');
    });

    it('should preserve original error properties when rethrowing', () => {
      const originalError = new ValidationError('Original message', { field: ['Error'] });

      try {
        throw originalError;
      } catch (caught) {
        if (caught instanceof ValidationError) {
          expect(caught).toBe(originalError);
          expect(caught.details).toEqual({ field: ['Error'] });
          expect(caught.statusCode).toBe(422);
        }
      }
    });
  });

  describe('Error Factory Patterns', () => {
    it('should create errors for common scenarios', () => {
      // User not found
      const userNotFound = new NotFoundError('User not found', ErrorCodes.RESOURCE_NOT_FOUND);
      expect(userNotFound.statusCode).toBe(404);

      // Validation with multiple fields
      const multiFieldValidation = new ValidationError('Multiple validation errors', {
        email: ['Invalid format'],
        password: ['Too short', 'Missing special character'],
        age: ['Must be a number'],
      });
      expect(Object.keys(multiFieldValidation.details!).length).toBe(3);

      // Rate limiting
      const rateLimited = new RateLimitError('Too many API calls', ErrorCodes.RATE_LIMIT_EXCEEDED);
      expect(rateLimited.statusCode).toBe(429);

      // Service integration error
      const serviceError = new BadRequestError('External service unavailable', ErrorCodes.MEM0_ERROR);
      expect(serviceError.code).toBe(ErrorCodes.MEM0_ERROR);
    });
  });

  describe('Error Edge Cases', () => {
    it('should handle empty and null messages', () => {
      const emptyError = new BaseError('');
      expect(emptyError.message).toBe('');

      const undefinedError = new BaseError(undefined as any);
      expect(emptyError.message).toBeDefined();
    });

    it('should handle extreme status codes', () => {
      const extremeError = new BaseError('Extreme error', 999, 'EXTREME');
      expect(extremeError.statusCode).toBe(999);
    });

    it('should handle complex validation details', () => {
      const complexDetails = {
        'nested.field': ['Nested validation error'],
        'array[0].property': ['Array item validation error'],
        'special-chars!@#': ['Special character field error'],
      };

      const complexError = new ValidationError('Complex validation', complexDetails);
      expect(complexError.details).toEqual(complexDetails);
    });
  });
});
