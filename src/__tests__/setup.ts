// Set test environment
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3001';
process.env['HOST'] = 'localhost';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test_memory_jar';
process.env['OPENAI_API_KEY'] = 'test_openai_key';
process.env['MEM0_API_KEY'] = 'test_mem0_key';
process.env['TWILIO_ACCOUNT_SID'] = 'test_twilio_sid';
process.env['TWILIO_AUTH_TOKEN'] = 'test_twilio_token';
process.env['TWILIO_WHATSAPP_NUMBER'] = 'whatsapp:+1234567890';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
