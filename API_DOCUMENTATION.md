# 📚 WhatsApp Memory Assistant - API Documentation

**Version**: 1.0.0  
**Base URL**: `http://localhost:3000` (development) | `https://your-domain.com` (production)  
**Authentication**: Not required for this demo (add authentication for production)

## 🔗 **Quick Navigation**

- [🏥 Health & Status](#-health--status)
- [💬 WhatsApp Webhook](#-whatsapp-webhook)
- [🧠 Memory Management](#-memory-management)
- [🔍 Memory Search & Querying](#-memory-search--querying)
- [⏰ Reminders](#-reminders)
- [🤝 Memory Sharing](#-memory-sharing)
- [📊 Analytics](#-analytics)
- [🎬 Media Management](#-media-management)
- [💬 Interactions](#-interactions)

---

## 🏥 **Health & Status**

### GET `/health`
Get overall system health and service status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-11-01T10:00:00.000Z",
  "details": {
    "services": {
      "database": { "status": "healthy", "responseTime": "5ms" },
      "openai": { "status": "healthy", "responseTime": "120ms" },
      "twilio": { "status": "healthy", "responseTime": "80ms" },
      "mem0": { "status": "healthy", "responseTime": "150ms" }
    },
    "version": "1.0.0",
    "uptime": "2h 45m 30s"
  }
}
```

---

## 💬 **WhatsApp Webhook**

### POST `/webhook`
Handles incoming WhatsApp messages from Twilio.

**Request Body** (from Twilio):
```json
{
  "MessageSid": "SM1234567890abcdef",
  "From": "whatsapp:+1234567890",
  "To": "whatsapp:+0987654321",
  "Body": "Remember to buy groceries tomorrow",
  "NumMedia": "0",
  "Timestamp": "2024-11-01T10:00:00.000Z",
  "AccountSid": "AC1234567890abcdef"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Memory created successfully",
  "messageSid": "SM1234567890abcdef",
  "userId": "user_123",
  "processingStatus": "memory_created",
  "response": {
    "id": "mem_456",
    "content": "Remember to buy groceries tomorrow",
    "moodDetection": {
      "mood": "neutral",
      "confidence": 0.85,
      "sentiment": "neutral"
    }
  }
}
```

---

## 🧠 **Memory Management**

### POST `/memories`
Create a new memory manually (alternative to WhatsApp).

**Request:**
```json
{
  "userId": "user_123",
  "content": "Had an amazing dinner at the new Italian restaurant",
  "memoryType": "TEXT",
  "tags": ["dinner", "restaurant", "food"],
  "importance": 8
}
```

**Response:**
```json
{
  "data": {
    "id": "mem_789",
    "content": "Had an amazing dinner at the new Italian restaurant",
    "memoryType": "TEXT",
    "importance": 8,
    "tags": ["dinner", "restaurant", "food", "happy", "social"],
    "moodDetection": {
      "mood": "happy",
      "confidence": 0.92,
      "sentiment": "positive",
      "intensity": "medium"
    },
    "createdAt": "2024-11-01T10:00:00.000Z"
  }
}
```

### GET `/memories/{id}`
Get a specific memory by ID.

**Response:**
```json
{
  "data": {
    "id": "mem_789",
    "content": "Had an amazing dinner at the new Italian restaurant",
    "memoryType": "TEXT",
    "importance": 8,
    "tags": ["dinner", "restaurant", "food", "happy"],
    "moodDetection": {
      "mood": "happy",
      "confidence": 0.92
    },
    "geoTagging": {
      "location": "Downtown",
      "coordinates": { "lat": 40.7128, "lng": -74.0060 }
    },
    "createdAt": "2024-11-01T10:00:00.000Z",
    "mediaFiles": []
  }
}
```

---

## 🔍 **Memory Search & Querying**

### GET `/memories`
Search and filter memories with advanced options.

**Query Parameters:**
- `query` (string): Natural language search query
- `userId` (string): Filter by user ID
- `memoryType` (string): Filter by type (TEXT, IMAGE, AUDIO, VIDEO, MIXED)
- `mood` (string): Filter by detected mood
- `timeframe` (string): Filter by time (today, week, month, year)
- `tags` (string): Comma-separated tags to filter by
- `page` (number): Page number for pagination
- `limit` (number): Number of results per page (max 50)

**Example Request:**
```
GET /memories?query=stressed%20presentation&mood=stressed&timeframe=week&limit=10
```

**Response:**
```json
{
  "data": [
    {
      "id": "mem_101",
      "content": "Feeling stressed about the big presentation tomorrow...",
      "memoryType": "TEXT",
      "relevanceScore": 0.95,
      "moodDetection": {
        "mood": "stressed",
        "confidence": 0.89,
        "sentiment": "negative"
      },
      "createdAt": "2024-10-30T15:30:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "query": "stressed presentation",
    "processingTime": "45ms"
  }
}
```

### GET `/memories/list`
Get all memories for a user with pagination (same as WhatsApp `/list` command).

**Query Parameters:**
- `userId` (string, required): User ID
- `page` (number): Page number (default: 1)
- `limit` (number): Results per page (default: 10, max: 50)

**Response:**
```json
{
  "data": [
    {
      "id": "mem_201",
      "content": "Grocery shopping list: milk, bread, eggs",
      "memoryType": "TEXT",
      "importance": 5,
      "createdAt": "2024-11-01T09:00:00.000Z"
    }
  ],
  "meta": {
    "total": 25,
    "page": 1,
    "limit": 10,
    "userId": "user_123"
  }
}
```

---

## ⏰ **Reminders**

### POST `/reminders`
Create a new reminder.

**Request:**
```json
{
  "userId": "user_123",
  "memoryId": "mem_456",
  "timeExpression": "tomorrow at 3 PM",
  "message": "Call mom",
  "timezone": "America/New_York"
}
```

**Response:**
```json
{
  "data": {
    "id": "rem_789",
    "userId": "user_123",
    "memoryId": "mem_456", 
    "message": "Call mom",
    "scheduledFor": "2024-11-02T15:00:00.000Z",
    "status": "PENDING",
    "createdAt": "2024-11-01T10:00:00.000Z"
  },
  "message": "Reminder created successfully for Nov 2, 2024 at 3:00 PM"
}
```

### GET `/reminders`
Get user's reminders with filtering.

**Query Parameters:**
- `userId` (string, required): User ID
- `status` (string): Filter by status (PENDING, SENT, CANCELLED)
- `page` (number): Page number
- `limit` (number): Results per page

**Response:**
```json
{
  "data": [
    {
      "id": "rem_789",
      "message": "Call mom",
      "scheduledFor": "2024-11-02T15:00:00.000Z",
      "status": "PENDING",
      "createdAt": "2024-11-01T10:00:00.000Z",
      "memory": {
        "id": "mem_456",
        "content": "Remember to call mom"
      }
    }
  ],
  "meta": {
    "total": 5,
    "pending": 3,
    "sent": 2,
    "cancelled": 0
  }
}
```

### DELETE `/reminders/{id}`
Cancel a reminder.

**Response:**
```json
{
  "data": {
    "id": "rem_789",
    "status": "CANCELLED",
    "cancelledAt": "2024-11-01T10:30:00.000Z"
  },
  "message": "Reminder cancelled successfully"
}
```

### GET `/reminders/stats`
Get reminder statistics.

**Response:**
```json
{
  "data": {
    "total": 150,
    "pending": 25,
    "sent": 120,
    "cancelled": 5,
    "successRate": 0.96,
    "avgResponseTime": "1.2s",
    "upcomingIn24h": 8
  }
}
```

---

## 🤝 **Memory Sharing**

### POST `/sharing/share`
Share a memory with another user.

**Request:**
```json
{
  "memoryId": "mem_123",
  "fromUserId": "user_456",
  "toPhoneNumber": "+1234567890",
  "message": "Check out this great coffee spot!"
}
```

**Response:**
```json
{
  "data": {
    "id": "share_789",
    "memoryId": "mem_123",
    "fromUserId": "user_456",
    "toUserId": "user_101",
    "message": "Check out this great coffee spot!",
    "status": "PENDING",
    "createdAt": "2024-11-01T10:00:00.000Z",
    "memory": {
      "content": "Amazing coffee at Blue Bottle downtown",
      "memoryType": "IMAGE"
    }
  },
  "message": "Memory shared successfully. The recipient has been notified via WhatsApp."
}
```

### POST `/sharing/{shareId}/accept`
Accept a shared memory.

**Request:**
```json
{
  "toUserId": "user_101",
  "copyToMyMemories": true
}
```

**Response:**
```json
{
  "data": {
    "id": "share_789",
    "status": "ACCEPTED",
    "respondedAt": "2024-11-01T10:15:00.000Z"
  },
  "message": "Memory share accepted and added to your memories!"
}
```

### POST `/sharing/{shareId}/reject`
Reject a shared memory.

**Request:**
```json
{
  "toUserId": "user_101"
}
```

**Response:**
```json
{
  "data": {
    "id": "share_789",
    "status": "REJECTED",
    "respondedAt": "2024-11-01T10:20:00.000Z"
  },
  "message": "Memory share rejected."
}
```

### GET `/sharing/shares`
Get user's memory shares.

**Query Parameters:**
- `userId` (string, required): User ID
- `type` (string): Filter by type (sent, received, all)
- `status` (string): Filter by status (PENDING, ACCEPTED, REJECTED)

**Response:**
```json
{
  "data": [
    {
      "id": "share_789",
      "memoryId": "mem_123",
      "status": "PENDING",
      "createdAt": "2024-11-01T10:00:00.000Z",
      "fromUser": {
        "phoneNumber": "+1234567890"
      },
      "toUser": {
        "phoneNumber": "+0987654321"
      },
      "memory": {
        "content": "Amazing coffee at Blue Bottle downtown",
        "memoryType": "IMAGE"
      }
    }
  ],
  "meta": {
    "userId": "user_456",
    "type": "sent",
    "count": 1
  }
}
```

### GET `/sharing/stats`
Get memory sharing statistics.

**Response:**
```json
{
  "data": {
    "totalShares": 45,
    "sentShares": 20,
    "receivedShares": 25,
    "acceptedShares": 30,
    "pendingShares": 10,
    "rejectedShares": 5,
    "acceptanceRate": 75
  }
}
```

---

## 📊 **Analytics**

### GET `/analytics/summary`
Get comprehensive analytics summary.

**Response:**
```json
{
  "data": {
    "overview": {
      "totalUsers": 150,
      "totalMemories": 2500,
      "totalInteractions": 3200,
      "totalMediaFiles": 800,
      "averageMemoriesPerUser": 16.7
    },
    "moodDetection": {
      "totalMemoriesWithMood": 2100,
      "moodDistribution": {
        "happy": 650,
        "neutral": 580,
        "excited": 320,
        "stressed": 280,
        "sad": 180,
        "angry": 90
      },
      "sentimentDistribution": {
        "positive": 1200,
        "neutral": 600,
        "negative": 300
      },
      "averageConfidence": 0.87,
      "topEmotionalIndicators": [
        "achievement",
        "family_time",
        "work_stress"
      ]
    },
    "geoTagging": {
      "totalMemoriesWithLocation": 450,
      "locationTypeDistribution": {
        "explicit_coordinates": 180,
        "text_extracted": 270
      },
      "topCities": [
        { "city": "New York", "count": 85 },
        { "city": "San Francisco", "count": 42 }
      ],
      "topCountries": [
        { "country": "United States", "count": 320 },
        { "country": "Canada", "count": 45 }
      ]
    },
    "reminders": {
      "total": 280,
      "pending": 45,
      "sent": 220,
      "cancelled": 15,
      "successRate": 0.94,
      "averageResponseTime": "1.8s"
    },
    "sharing": {
      "totalShares": 120,
      "acceptedShares": 85,
      "acceptanceRate": 71
    },
    "media": {
      "totalFiles": 800,
      "totalSize": "2.4GB",
      "uniqueFiles": 650,
      "deduplicationRate": 0.19,
      "typeDistribution": {
        "image/jpeg": 320,
        "image/png": 180,
        "audio/mpeg": 150,
        "video/mp4": 100,
        "application/pdf": 50
      }
    },
    "interactions": {
      "totalInteractions": 3200,
      "successfulInteractions": 3040,
      "successRate": 0.95,
      "averageProcessingTime": "2.1s",
      "messageTypeDistribution": {
        "TEXT": 1800,
        "IMAGE": 800,
        "AUDIO": 400,
        "VIDEO": 150,
        "DOCUMENT": 50
      }
    },
    "generatedAt": "2024-11-01T10:00:00.000Z"
  }
}
```

---

## 🎬 **Media Management**

### POST `/media/upload`
Upload media file directly (alternative to WhatsApp).

**Request** (multipart/form-data):
- `file`: Media file
- `userId`: User ID
- `interactionId`: Optional interaction ID
- `memoryId`: Optional memory ID

**Response:**
```json
{
  "data": {
    "id": "media_456",
    "fileUrl": "/storage/media/images/abc123.jpg",
    "contentType": "image/jpeg",
    "size": 2048576,
    "fingerprint": "sha256:abc123...",
    "isDeduplication": false,
    "createdAt": "2024-11-01T10:00:00.000Z"
  }
}
```

### GET `/media/{id}`
Get media file information.

**Response:**
```json
{
  "data": {
    "id": "media_456",
    "fileUrl": "/storage/media/images/abc123.jpg",
    "contentType": "image/jpeg",
    "size": 2048576,
    "fingerprint": "sha256:abc123...",
    "uploadedAt": "2024-11-01T10:00:00.000Z",
    "associatedMemories": 2,
    "downloadCount": 5
  }
}
```

### GET `/media/stats`
Get media storage statistics.

**Response:**
```json
{
  "data": {
    "totalFiles": 800,
    "totalSize": 2516582400,
    "uniqueFiles": 650,
    "deduplicationRate": 0.1875,
    "byType": {
      "image/jpeg": 320,
      "image/png": 180,
      "audio/mpeg": 150,
      "video/mp4": 100
    },
    "averageFileSize": "3.1MB",
    "storageUsed": "2.4GB"
  }
}
```

---

## 💬 **Interactions**

### GET `/interactions/recent`
Get recent user interactions.

**Query Parameters:**
- `userId` (string): Filter by user ID
- `limit` (number): Number of results (default: 10, max: 100)
- `messageType` (string): Filter by message type
- `status` (string): Filter by status

**Response:**
```json
{
  "data": [
    {
      "id": "int_123",
      "userId": "user_456",
      "messageSid": "SM1234567890abcdef",
      "messageType": "TEXT",
      "direction": "INBOUND",
      "status": "PROCESSED",
      "processingTime": 1850,
      "createdAt": "2024-11-01T10:00:00.000Z",
      "response": {
        "type": "memory_created",
        "content": "Memory saved successfully!"
      }
    }
  ],
  "meta": {
    "total": 3200,
    "limit": 10,
    "averageProcessingTime": "2.1s"
  }
}
```

---

## 🔧 **Error Responses**

All endpoints follow consistent error response format:

### 400 Bad Request
```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Missing required field: userId",
    "details": {
      "field": "userId",
      "expected": "string (cuid)"
    }
  },
  "timestamp": "2024-11-01T10:00:00.000Z",
  "requestId": "req_123"
}
```

### 404 Not Found
```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Memory not found",
    "details": {
      "resource": "memory",
      "id": "mem_nonexistent"
    }
  },
  "timestamp": "2024-11-01T10:00:00.000Z",
  "requestId": "req_456"
}
```

### 500 Internal Server Error
```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred",
    "details": {
      "description": "Database connection timeout"
    }
  },
  "timestamp": "2024-11-01T10:00:00.000Z",
  "requestId": "req_789"
}
```

---

## 📝 **Usage Examples**

### Creating a Memory with Mood Detection
```bash
curl -X POST "http://localhost:3000/memories" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "content": "Had the best day at the beach with family!",
    "memoryType": "TEXT"
  }'
```

### Searching Memories by Mood
```bash
curl "http://localhost:3000/memories?userId=user_123&mood=happy&limit=5"
```

### Creating a Natural Language Reminder
```bash
curl -X POST "http://localhost:3000/reminders" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "timeExpression": "tomorrow at 3 PM",
    "message": "Call the dentist"
  }'
```

### Sharing a Memory
```bash
curl -X POST "http://localhost:3000/sharing/share" \
  -H "Content-Type: application/json" \
  -d '{
    "memoryId": "mem_123",
    "fromUserId": "user_456",
    "toPhoneNumber": "+1234567890",
    "message": "You should try this restaurant!"
  }'
```

### Getting Analytics Summary
```bash
curl "http://localhost:3000/analytics/summary" | jq '.data.moodDetection'
```

---

## 🚀 **Rate Limits**

- **General API**: 100 requests per minute per IP
- **Webhook endpoint**: 1000 requests per minute (higher for WhatsApp traffic)
- **Analytics endpoints**: 10 requests per minute per IP

## 🔒 **Security Notes**

- All sensitive data is logged with appropriate masking
- Phone numbers are partially masked in logs (last 4 digits visible)
- Media files are stored with secure filenames
- Database queries use parameterized statements to prevent injection

## 📞 **Support**

For technical support or questions about the API:
- Check the health endpoint first: `GET /health`
- Review logs in `/logs/` directory  
- Verify environment variables are set correctly
- Ensure database is accessible and migrated

---

**Last Updated**: November 1, 2024  
**API Version**: 1.0.0
