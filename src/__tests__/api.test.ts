import request from 'supertest';
import app from '../app';

describe('API Structure', () => {
  describe('Root Endpoint', () => {
    it('should return API information', async () => {
      const response = await request(app).get('/');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Memory Jar API');
      expect(response.body).toHaveProperty('version', '1.0.0');
      expect(response.body).toHaveProperty('environment');
      expect(response.body).toHaveProperty('endpoints');
      expect(response.body.endpoints).toHaveProperty('health');
      expect(response.body.endpoints).toHaveProperty('users');
      expect(response.body.endpoints).toHaveProperty('memories');
    });
  });

  describe('User Routes', () => {
    it('should return 404 for non-existent user', async () => {
      const response = await request(app).get('/users/nonexistent');
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code');
    });

    it('should validate user creation data', async () => {
      const response = await request(app).post('/users').send({
        // Missing required phoneNumber
        name: 'Test User',
      });
      
      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('details');
    });
  });

  describe('Memory Routes', () => {
    it('should return 404 for non-existent memory', async () => {
      const response = await request(app).get('/memories/nonexistent');
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code');
    });

    it('should validate memory creation data', async () => {
      const response = await request(app).post('/memories').send({
        // Missing required fields
        content: 'Test memory',
      });
      
      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('details');
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 errors properly', async () => {
      const response = await request(app).get('/nonexistent-route');
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Not Found');
      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should handle validation errors properly', async () => {
      const response = await request(app).get('/users/invalid-cuid');
      
      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code');
    });
  });
});
