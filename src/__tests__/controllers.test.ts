import { NotFoundError, ValidationError, BadRequestError } from '../utils/errors';

// Mock all external dependencies
jest.mock('../services/database');
jest.mock('../services/mem0Service');
jest.mock('../services/multimodalService');

describe('Controller Tests', () => {
  describe('Error Handling', () => {
    it('should handle NotFoundError correctly', () => {
      const error = new NotFoundError('Resource not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('RESOURCE_NOT_FOUND');
      expect(error.message).toBe('Resource not found');
    });

    it('should handle ValidationError correctly', () => {
      const details = { field: ['Required'] };
      const error = new ValidationError('Validation failed', details);
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual(details);
    });

    it('should handle BadRequestError correctly', () => {
      const error = new BadRequestError('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toBe('Invalid input');
    });
  });
});

