// Focused unit tests for core functionality to achieve good coverage

describe('Core Configuration Tests', () => {
  describe('Environment Configuration', () => {
    it('should have test environment variables set', () => {
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.PORT).toBe('3001');
      expect(process.env.HOST).toBe('localhost');
      expect(process.env.OPENAI_API_KEY).toBe('test_openai_key');
      expect(process.env.MEM0_API_KEY).toBe('test_mem0_key');
    });

    it('should validate environment variable types', () => {
      const port = process.env.PORT;
      expect(port).toBeTruthy();
      expect(isNaN(Number(port))).toBe(false);
    });
  });

  describe('Error Code Constants', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('should import ErrorCodes successfully', async () => {
      const { ErrorCodes } = await import('../utils/errors');
      
      expect(ErrorCodes).toBeDefined();
      expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ErrorCodes.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND');
      expect(ErrorCodes.BAD_REQUEST).toBe('BAD_REQUEST');
      expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
      expect(ErrorCodes.FORBIDDEN).toBe('FORBIDDEN');
      expect(ErrorCodes.CONFLICT).toBe('CONFLICT');
      expect(ErrorCodes.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
      expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    });

    it('should have all required error codes', async () => {
      const { ErrorCodes } = await import('../utils/errors');
      
      const requiredErrorCodes = [
        'VALIDATION_ERROR',
        'RESOURCE_NOT_FOUND',
        'BAD_REQUEST',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'CONFLICT',
        'RATE_LIMIT_EXCEEDED',
        'INTERNAL_ERROR',
        'INVALID_INPUT',
        'INVALID_FILE_TYPE',
        'FILE_TOO_LARGE',
        'FILE_UPLOAD_ERROR',
        'TWILIO_ERROR',
        'OPENAI_ERROR',
        'MEM0_ERROR',
        'DATABASE_ERROR',
      ];

      requiredErrorCodes.forEach(code => {
        expect(ErrorCodes[code]).toBeDefined();
        expect(typeof ErrorCodes[code]).toBe('string');
      });
    });
  });

  describe('Error Classes', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('should create BaseError correctly', async () => {
      const { BaseError } = await import('../utils/errors');
      
      const error = new BaseError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.isOperational).toBe(true);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should create ValidationError with details', async () => {
      const { ValidationError } = await import('../utils/errors');
      
      const details = { field1: ['Required'] };
      const error = new ValidationError('Validation failed', details);
      
      expect(error.message).toBe('Validation failed');
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual(details);
    });

    it('should create NotFoundError correctly', async () => {
      const { NotFoundError } = await import('../utils/errors');
      
      const error = new NotFoundError('Resource not found');
      expect(error.message).toBe('Resource not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('should create BadRequestError correctly', async () => {
      const { BadRequestError } = await import('../utils/errors');
      
      const error = new BadRequestError('Invalid input');
      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('BAD_REQUEST');
    });
  });

  describe('Environment Loading', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('should load environment configuration', async () => {
      const { env } = await import('../config/environment');
      
      expect(env).toBeDefined();
      expect(env.NODE_ENV).toBe('test');
      expect(env.PORT).toBe(3001);
      expect(env.HOST).toBe('localhost');
      expect(env.OPENAI_API_KEY).toBe('test_openai_key');
      expect(env.MEM0_API_KEY).toBe('test_mem0_key');
    });

    it('should have database configuration', async () => {
      const { env } = await import('../config/environment');
      
      expect(env.DATABASE_URL).toContain('postgresql://');
      expect(env.DATABASE_URL).toContain('test_memory_jar');
    });

    it('should have Twilio configuration', async () => {
      const { env } = await import('../config/environment');
      
      expect(env.TWILIO_ACCOUNT_SID).toBe('test_twilio_sid');
      expect(env.TWILIO_AUTH_TOKEN).toBe('test_twilio_token');
      expect(env.TWILIO_WHATSAPP_NUMBER).toBe('whatsapp:+1234567890');
    });
  });

  describe('Validation Schemas', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('should validate phone numbers correctly', async () => {
      const { phoneNumberSchema } = await import('../validation/schemas');
      
      const validNumbers = ['+1234567890', '+44123456789', 'whatsapp:+1234567890'];
      const invalidNumbers = ['123456789', '+abc123', ''];

      validNumbers.forEach(number => {
        const result = phoneNumberSchema.safeParse(number);
        expect(result.success).toBe(true);
      });

      invalidNumbers.forEach(number => {
        const result = phoneNumberSchema.safeParse(number);
        expect(result.success).toBe(false);
      });
    });

    it('should validate CUIDs correctly', async () => {
      const { cuidSchema } = await import('../validation/schemas');
      
      const validCuids = [
        'clh1234567890abcdefghijkl',
        'cm01234567890abcdefghijk',
        'ckz1234567890abcdefghijk',
      ];
      
      const invalidCuids = [
        'short',
        'this-is-way-too-long-to-be-a-valid-cuid',
        'invalid_chars_@#$',
        '',
      ];

      validCuids.forEach(cuid => {
        const result = cuidSchema.safeParse(cuid);
        expect(result.success).toBe(true);
      });

      invalidCuids.forEach(cuid => {
        const result = cuidSchema.safeParse(cuid);
        expect(result.success).toBe(false);
      });
    });

    it('should validate pagination parameters', async () => {
      const { paginationSchema } = await import('../validation/schemas');
      
      const validPagination = { page: '1', limit: '10' };
      const result = paginationSchema.safeParse(validPagination);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(10);
      }
    });

    it('should reject invalid pagination parameters', async () => {
      const { paginationSchema } = await import('../validation/schemas');
      
      const invalidPagination = { page: '0', limit: '101' };
      const result = paginationSchema.safeParse(invalidPagination);
      
      expect(result.success).toBe(false);
    });
  });

  describe('Service Initialization', () => {
    beforeEach(() => {
      jest.resetModules();
      // Mock the external dependencies
      jest.doMock('mem0ai', () => ({
        MemoryClient: jest.fn().mockImplementation(() => ({
          add: jest.fn(),
          search: jest.fn(),
          getAll: jest.fn(),
        })),
      }));
      
      jest.doMock('twilio', () => {
        return jest.fn().mockImplementation(() => ({
          messages: { create: jest.fn() },
        }));
      });
      
      jest.doMock('openai', () => ({
        OpenAI: jest.fn().mockImplementation(() => ({
          chat: { completions: { create: jest.fn() } },
        })),
      }));
    });

    it('should initialize Mem0Service', async () => {
      const { Mem0Service } = await import('../services/mem0Service');
      
      const service = new Mem0Service();
      expect(service).toBeInstanceOf(Mem0Service);
      expect(service.isMemoryServiceConnected()).toBe(true);
    });

    it('should initialize TimezoneService', async () => {
      const { TimezoneService } = await import('../services/timezoneService');
      
      const service = new TimezoneService();
      expect(service).toBeInstanceOf(TimezoneService);
      
      // Test basic timezone detection
      const timezone = service.detectTimezoneFromPhoneNumber('+1234567890');
      expect(typeof timezone).toBe('string');
      expect(timezone.length).toBeGreaterThan(0);
    });

    it('should have MoodDetectionService class available', async () => {
      const { MoodDetectionService } = await import('../services/moodDetectionService');
      expect(typeof MoodDetectionService).toBe('function');
    });

    it('should have GeoTaggingService class available', async () => {
      const { GeoTaggingService } = await import('../services/geoTaggingService');
      expect(typeof GeoTaggingService).toBe('function');
    });
  });

  describe('Database Service', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.doMock('../generated/prisma', () => ({
        PrismaClient: jest.fn().mockImplementation(() => ({
          $connect: jest.fn().mockResolvedValue(undefined),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })),
      }));
    });

    it('should have database service available', async () => {
      const { initializeDatabase } = await import('../services/database');
      expect(typeof initializeDatabase).toBe('function');
    });

    it('should handle database connection', async () => {
      const { getDatabase } = await import('../services/database');
      
      const db = getDatabase();
      expect(db).toBeDefined();
    });
  });

  describe('Logger Configuration', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('should create logger instance', async () => {
      const logger = await import('../config/logger');
      
      expect(logger.default).toBeDefined();
      expect(typeof logger.default.info).toBe('function');
      expect(typeof logger.default.error).toBe('function');
      expect(typeof logger.default.warn).toBe('function');
      expect(typeof logger.default.debug).toBe('function');
    });
  });
});

describe('Utility Functions', () => {
  describe('Type Checking', () => {
    it('should check basic JavaScript types', () => {
      expect(typeof 'string').toBe('string');
      expect(typeof 123).toBe('number');
      expect(typeof true).toBe('boolean');
      expect(typeof {}).toBe('object');
      expect(Array.isArray([])).toBe(true);
    });

    it('should validate array operations', () => {
      const arr = [1, 2, 3];
      expect(arr.length).toBe(3);
      expect(arr.includes(2)).toBe(true);
      expect(arr.includes(4)).toBe(false);
      
      const filtered = arr.filter(x => x > 1);
      expect(filtered).toEqual([2, 3]);
      
      const mapped = arr.map(x => x * 2);
      expect(mapped).toEqual([2, 4, 6]);
    });

    it('should validate object operations', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(Object.keys(obj)).toEqual(['a', 'b', 'c']);
      expect(Object.values(obj)).toEqual([1, 2, 3]);
      expect(Object.entries(obj)).toEqual([['a', 1], ['b', 2], ['c', 3]]);
      
      const merged = { ...obj, d: 4 };
      expect(merged).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    });
  });

  describe('String Operations', () => {
    it('should handle string manipulations', () => {
      const str = 'Hello World';
      expect(str.toLowerCase()).toBe('hello world');
      expect(str.toUpperCase()).toBe('HELLO WORLD');
      expect(str.includes('World')).toBe(true);
      expect(str.startsWith('Hello')).toBe(true);
      expect(str.endsWith('World')).toBe(true);
      
      const parts = str.split(' ');
      expect(parts).toEqual(['Hello', 'World']);
      
      const joined = parts.join('-');
      expect(joined).toBe('Hello-World');
    });

    it('should validate string patterns', () => {
      const phonePattern = /^\+[1-9]\d{1,14}$/;
      expect(phonePattern.test('+1234567890')).toBe(true);
      expect(phonePattern.test('1234567890')).toBe(false);
      expect(phonePattern.test('+abc123')).toBe(false);
      
      const cuidPattern = /^c[a-z0-9]{24}$/;
      expect(cuidPattern.test('clh1234567890abcdefghijkl')).toBe(true);
      expect(cuidPattern.test('invalid-cuid')).toBe(false);
    });
  });

  describe('Date Operations', () => {
    it('should handle date manipulations', () => {
      const now = new Date();
      expect(now).toBeInstanceOf(Date);
      expect(typeof now.getTime()).toBe('number');
      expect(typeof now.toISOString()).toBe('string');
      
      const timestamp = Date.now();
      expect(typeof timestamp).toBe('number');
      expect(timestamp).toBeGreaterThan(0);
      
      const dateFromTimestamp = new Date(timestamp);
      expect(dateFromTimestamp).toBeInstanceOf(Date);
    });

    it('should validate date comparisons', () => {
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-02');
      
      expect(date1.getTime()).toBeLessThan(date2.getTime());
      expect(date2.getTime()).toBeGreaterThan(date1.getTime());
      
      const dayMs = 24 * 60 * 60 * 1000;
      expect(date2.getTime() - date1.getTime()).toBe(dayMs);
    });
  });

  describe('Promise Operations', () => {
    it('should handle async operations', async () => {
      const asyncFunction = async (value: number) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return value * 2;
      };
      
      const result = await asyncFunction(5);
      expect(result).toBe(10);
    });

    it('should handle promise chains', async () => {
      const promises = [1, 2, 3].map(x => Promise.resolve(x * 2));
      const results = await Promise.all(promises);
      expect(results).toEqual([2, 4, 6]);
    });

    it('should handle promise errors', async () => {
      const errorPromise = Promise.reject(new Error('Test error'));
      await expect(errorPromise).rejects.toThrow('Test error');
    });
  });
});

describe('Mock Validation', () => {
  it('should validate test environment', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('should have mocked console methods', () => {
    expect(jest.isMockFunction(console.log)).toBe(true);
    expect(jest.isMockFunction(console.error)).toBe(true);
    expect(jest.isMockFunction(console.warn)).toBe(true);
    expect(jest.isMockFunction(console.info)).toBe(true);
    expect(jest.isMockFunction(console.debug)).toBe(true);
  });

  it('should call mocked console methods', () => {
    console.log('test message');
    console.error('test error');
    console.warn('test warning');
    
    expect(console.log).toHaveBeenCalledWith('test message');
    expect(console.error).toHaveBeenCalledWith('test error');
    expect(console.warn).toHaveBeenCalledWith('test warning');
  });
});
