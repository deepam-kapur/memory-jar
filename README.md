# WhatsApp Memory Assistant

A WhatsApp chatbot that uses Twilio's WhatsApp API and Mem0's memory layer to ingest and recall images, audio, and text as memories. The bot supports natural language queries and provides persistent memory storage with multimodal content processing.

## 🚀 Features

- **Multimodal Message Ingestion**: Accept and process text, images, voice notes, and documents
- **Semantic Memory Storage**: Store entries in Mem0 with metadata and embeddings for fast, semantic retrieval
- **Database Persistence**: Custom schema to capture user interactions and memories with idempotent ingestion
- **Interactive Chat**: Handle conversational queries using context awareness
- **Memory Listing**: `/list` command to enumerate all user memories
- **DB-backed Queries & Analytics**: Endpoints for recent interactions and analytics summary
- **Media Deduplication**: SHA-256 fingerprinting for identical media files
- **Timezone-aware Filtering**: Support "last week" type queries in user's timezone
- **Real-time Processing**: Live media download, transcription, and memory creation

## 🏗️ Architecture

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   WhatsApp      │    │   Twilio API    │    │   Memory Jar    │
│   (User)        │◄──►│   (Webhook)     │◄──►│   (Backend)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Mem0 API      │    │   OpenAI        │    │   PostgreSQL    │
│   (Memory)      │◄──►│   (Whisper)     │◄──►│   (Database)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Technology Stack

- **Backend**: Node.js with TypeScript and Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Memory Layer**: Mem0 for semantic memory storage and retrieval
- **Media Processing**: OpenAI Whisper for audio transcription
- **WhatsApp Integration**: Twilio WhatsApp API
- **File Storage**: Local storage with deduplication
- **Validation**: Zod schema validation
- **Testing**: Jest for unit and integration tests

## 📋 Prerequisites

- Node.js 18+ and npm
- PostgreSQL database
- Twilio account with WhatsApp sandbox
- Mem0 API key
- OpenAI API key

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd memory-jar
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your configuration:
   ```env
   # Server Configuration
   NODE_ENV=development
   PORT=3000
   HOST=localhost

   # Database Configuration
   DATABASE_URL="postgresql://username:password@localhost:5432/memory_jar"

   # Twilio Configuration
   TWILIO_ACCOUNT_SID=your_twilio_account_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

   # Mem0 Configuration
   MEM0_API_KEY=your_mem0_api_key
   MEM0_BASE_URL=https://api.mem0.ai

   # OpenAI Configuration (for Whisper)
   OPENAI_API_KEY=your_openai_api_key

   # Logging Configuration
   LOG_LEVEL=info
   LOG_FILE=logs/app.log
   ```

4. **Set up the database**
   ```bash
   # Run database migrations
   npx prisma migrate dev
   
   # Seed the database (optional)
   npm run seed
   ```

5. **Build the project**
   ```bash
   npm run build
   ```

6. **Start the server**
   ```bash
   npm start
   ```

## 🔧 Configuration

### Twilio WhatsApp Setup

1. Create a Twilio account and get your Account SID and Auth Token
2. Set up WhatsApp sandbox in Twilio Console
3. Configure webhook URL: `https://your-domain.com/webhook`
4. Add your Twilio credentials to `.env`

### Mem0 Setup

1. Sign up for Mem0 at [mem0.ai](https://mem0.ai)
2. Get your API key from the dashboard
3. Add your Mem0 API key to `.env`

### OpenAI Setup

1. Create an OpenAI account and get your API key
2. Add your OpenAI API key to `.env` for Whisper transcription

## 📡 API Endpoints

### Core Endpoints

#### `POST /webhook`
Handles incoming Twilio WhatsApp messages.

**Request Body:**
```json
{
  "MessageSid": "SM1234567890",
  "From": "whatsapp:+1234567890",
  "Body": "Hello world",
  "NumMedia": "0"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook processed successfully",
  "userId": "user_123",
  "memoryId": "memory_456"
}
```

#### `POST /memories`
Add multimodal memories (text, image, audio).

**Request Body:**
```json
{
  "content": "Remember to buy groceries",
  "userId": "user_123",
  "memoryType": "TEXT",
  "tags": ["reminder", "groceries"]
}
```

#### `GET /memories?query=<text>`
Search memories via Mem0 + enrich with DB.

**Response:**
```json
{
  "memories": [
    {
      "id": "memory_123",
      "content": "Remember to buy groceries",
      "memoryType": "TEXT",
      "score": 0.95,
      "metadata": {
        "userId": "user_123",
        "createdAt": "2024-01-01T12:00:00Z"
      }
    }
  ]
}
```

#### `GET /memories/list`
Return all memories from DB (newest first).

#### `GET /interactions/recent?limit=<n>`
Return recent interactions from DB.

#### `GET /analytics/summary`
Return DB-derived statistics.

### Health Check

#### `GET /health`
System health check.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00Z",
  "services": {
    "database": "healthy",
    "mem0": "healthy",
    "twilio": "healthy",
    "openai": "healthy"
  }
}
```

## 🧪 Testing

### Run Tests
```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run E2E tests
node test-e2e.js
```

### Test Flows
```bash
# Test memory flows
./flows/memory-flows.sh

# Test webhook flows
./flows/webhook-flows.sh

# Test analytics flows
./flows/analytics-flows.sh

# Test all flows
./flows/test-all-flows.sh
```

## 📊 Database Schema

### Core Tables

#### Users
- `id`: Primary key (CUID)
- `phoneNumber`: WhatsApp phone number (unique)
- `timezone`: User's timezone
- `createdAt`: Account creation timestamp

#### Interactions
- `id`: Primary key (CUID)
- `userId`: Foreign key to Users
- `messageSid`: Twilio MessageSid (unique, for idempotency)
- `messageType`: TEXT, IMAGE, AUDIO, etc.
- `content`: Message content or description
- `timestamp`: Message timestamp

#### Memories
- `id`: Primary key (CUID)
- `userId`: Foreign key to Users
- `interactionId`: Foreign key to Interactions
- `mem0Id`: Mem0 memory ID
- `content`: Memory content
- `memoryType`: TEXT, IMAGE, AUDIO, MIXED
- `tags`: JSON array of tags
- `importance`: 1-10 scale

#### MediaFiles
- `id`: Primary key (CUID)
- `userId`: Foreign key to Users
- `interactionId`: Foreign key to Interactions
- `fileName`: Stored filename
- `originalName`: Original filename
- `fileType`: MIME type
- `fileSize`: File size in bytes
- `fingerprint`: SHA-256 hash for deduplication
- `transcription`: Audio transcription (if applicable)

## 🔒 Security Features

- **Input Validation**: Zod schema validation for all inputs
- **Rate Limiting**: Express rate limiting for API protection
- **XSS Protection**: Input sanitization and cleaning
- **Error Handling**: Comprehensive error handling without information leakage
- **Idempotency**: Prevents duplicate processing of messages
- **Media Deduplication**: SHA-256 fingerprinting for identical files

## 🚀 Deployment

### Production Deployment

1. **Build the application**
   ```bash
   npm run build
   ```

2. **Set production environment variables**
   ```bash
   NODE_ENV=production
   DATABASE_URL="postgresql://user:pass@host:5432/memory_jar"
   ```

3. **Run database migrations**
   ```bash
   npx prisma migrate deploy
   ```

4. **Start the application**
   ```bash
   npm start
   ```

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/app.js"]
```

## 📝 Usage Examples

### WhatsApp Commands

1. **Send a text message**: "Remember to buy milk tomorrow"
2. **Send an image**: Upload a photo with caption "My new haircut"
3. **Send a voice note**: Record "Meeting at 3 PM today"
4. **Query memories**: "What did I plan for dinner?"
5. **List all memories**: "/list"
6. **Search by time**: "Show me memories from last week"

### API Usage

```bash
# Create a memory
curl -X POST http://localhost:3000/memories \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Important meeting notes",
    "userId": "user_123",
    "memoryType": "TEXT"
  }'

# Search memories
curl "http://localhost:3000/memories?query=meeting"

# Get analytics
curl http://localhost:3000/analytics/summary
```

## 🔧 Development

### Project Structure
```
src/
├── config/          # Configuration files
├── controllers/     # Request handlers
├── middleware/      # Express middleware
├── routes/          # API routes
├── services/        # Business logic services
├── validation/      # Schema validation
└── utils/           # Utility functions
```

### Adding New Features

1. **Create service**: Add business logic in `src/services/`
2. **Add controller**: Create request handler in `src/controllers/`
3. **Define route**: Add API endpoint in `src/routes/`
4. **Add validation**: Create Zod schema in `src/validation/`
5. **Write tests**: Add test cases in `src/__tests__/`

## 🐛 Troubleshooting

### Common Issues

1. **Database Connection Error**
   - Check `DATABASE_URL` in `.env`
   - Ensure PostgreSQL is running
   - Run `npx prisma migrate dev`

2. **Twilio Webhook Errors**
   - Verify webhook URL is accessible
   - Check Twilio credentials
   - Ensure webhook signature validation

3. **Mem0 API Errors**
   - Verify `MEM0_API_KEY` is correct
   - Check API rate limits
   - Ensure proper API permissions

4. **Media Processing Issues**
   - Check file permissions in storage directory
   - Verify OpenAI API key for transcription
   - Monitor disk space for media storage

### Logs

Check application logs:
```bash
# View application logs
tail -f logs/app.log

# View error logs
tail -f logs/exceptions-*.log
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## 📞 Support

For support and questions:
- Create an issue in the GitHub repository
- Check the [documentation](docs/)
- Review the [troubleshooting guide](#troubleshooting)

## 🎯 Roadmap

- [ ] Real-time memory synchronization
- [ ] Advanced analytics and insights
- [ ] Memory sharing between users
- [ ] Mobile app companion
- [ ] Integration with calendar apps
- [ ] Voice command support
- [ ] Multi-language support
- [ ] Advanced search filters
- [ ] Memory export/import
- [ ] Automated memory categorization
