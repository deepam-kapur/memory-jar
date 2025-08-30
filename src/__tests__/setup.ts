// Set test environment
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3001';
process.env['HOST'] = 'localhost';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
