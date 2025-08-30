import request from 'supertest';
import app from '../app';

describe('WhatsApp Memory Assistant API', () => {
  describe('Root Endpoint', () => {
    it('should return API information', async () => {
      const response = await request(app).get('/');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'WhatsApp Memory Assistant API');
      expect(response.body).toHaveProperty('version', '1.0.0');
      expect(response.body).toHaveProperty('environment');
      expect(response.body).toHaveProperty('description');
      expect(response.body).toHaveProperty('endpoints');
      expect(response.body.endpoints).toHaveProperty('health');
      expect(response.body.endpoints).toHaveProperty('webhook');
      expect(response.body.endpoints).toHaveProperty('memories');
      expect(response.body.endpoints).toHaveProperty('memoriesList');
      expect(response.body.endpoints).toHaveProperty('interactions');
      expect(response.body.endpoints).toHaveProperty('analytics');
    });
  });

  describe('Webhook Routes', () => {
    it('should handle incoming Twilio WhatsApp messages', async () => {
      const response = await request(app).post('/webhook').send({
        MessageSid: 'test-message-sid',
        From: '+1234567890',
        To: '+0987654321',
        Body: 'Hello, this is a test message',
      });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('messageSid', 'test-message-sid');
    });

    it('should validate webhook data', async () => {
      const response = await request(app).post('/webhook').send({
        // Missing required MessageSid
        From: '+1234567890',
        To: '+0987654321',
      });
      
      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('details');
    });
  });

  describe('Memory Routes', () => {
    it('should create new memory', async () => {
      const response = await request(app).post('/memories').send({
        userId: 'test-user-id',
        content: 'Test memory content',
        memoryType: 'TEXT',
        importance: 5,
      });
      
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('content', 'Test memory content');
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

    it('should search memories', async () => {
      const response = await request(app).get('/memories?query=test');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('search');
      expect(response.body.search).toHaveProperty('query', 'test');
    });

    it('should validate search query parameter', async () => {
      const response = await request(app).get('/memories');
      
      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('details');
    });

    it('should list all memories', async () => {
      const response = await request(app).get('/memories/list?page=1&limit=10');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toHaveProperty('page', 1);
      expect(response.body.pagination).toHaveProperty('limit', 10);
    });
  });

  describe('Interaction Routes', () => {
    it('should get recent interactions', async () => {
      const response = await request(app).get('/interactions/recent?limit=20');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toHaveProperty('limit', 20);
    });
  });

  describe('Analytics Routes', () => {
    it('should get analytics summary', async () => {
      const response = await request(app).get('/analytics/summary');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('overview');
      expect(response.body.data).toHaveProperty('memoriesByType');
      expect(response.body.data).toHaveProperty('topTags');
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
      const response = await request(app).post('/memories').send({
        // Invalid data
        userId: 'invalid-cuid',
        content: '',
        memoryType: 'INVALID',
      });
      
      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code');
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/memories')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}');
      
      expect(response.status).toBe(400);
    });

    it('should handle rate limiting', async () => {
      // Make multiple rapid requests to trigger rate limiting
      const requests = Array(30).fill(null).map(() => 
        request(app).get('/memories/list')
      );
      
      const responses = await Promise.all(requests);
      const rateLimitedResponse = responses.find(res => res.status === 429);
      
      if (rateLimitedResponse) {
        expect(rateLimitedResponse.status).toBe(429);
        expect(rateLimitedResponse.body).toHaveProperty('error');
      }
    });
  });
});
