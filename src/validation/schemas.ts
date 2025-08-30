import { z } from 'zod';

// Common validation schemas
export const phoneNumberSchema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be in E.164 format (e.g., +1234567890)');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const searchSchema = z.object({
  query: z.string().min(1).max(500),
  ...paginationSchema.shape,
});

// User schemas
export const createUserSchema = z.object({
  phoneNumber: phoneNumberSchema,
  name: z.string().min(1).max(100).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const getUserSchema = z.object({
  userId: z.string().cuid(),
});

// Interaction schemas
export const createInteractionSchema = z.object({
  userId: z.string().cuid(),
  messageType: z.enum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'LOCATION', 'CONTACT']),
  content: z.string().max(10000).optional(),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const updateInteractionSchema = z.object({
  status: z.enum(['PENDING', 'PROCESSED', 'FAILED', 'IGNORED']).optional(),
  content: z.string().max(10000).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const getInteractionsSchema = z.object({
  userId: z.string().cuid().optional(),
  messageType: z.enum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'LOCATION', 'CONTACT']).optional(),
  direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
  status: z.enum(['PENDING', 'PROCESSED', 'FAILED', 'IGNORED']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  ...paginationSchema.shape,
});

// Memory schemas
export const createMemorySchema = z.object({
  userId: z.string().cuid(),
  interactionId: z.string().cuid().optional(),
  content: z.string().min(1).max(10000),
  mem0Id: z.string().optional(),
  memoryType: z.enum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'MIXED']),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  importance: z.number().int().min(1).max(10).default(1),
});

export const updateMemorySchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  importance: z.number().int().min(1).max(10).optional(),
});

export const getMemoriesSchema = z.object({
  userId: z.string().cuid().optional(),
  memoryType: z.enum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'MIXED']).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
  minImportance: z.coerce.number().int().min(1).max(10).optional(),
  maxImportance: z.coerce.number().int().min(1).max(10).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  ...paginationSchema.shape,
});

export const searchMemoriesSchema = z.object({
  query: z.string().min(1).max(500),
  userId: z.string().cuid().optional(),
  memoryType: z.enum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'MIXED']).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
  minImportance: z.coerce.number().int().min(1).max(10).optional(),
  maxImportance: z.coerce.number().int().min(1).max(10).optional(),
  ...paginationSchema.shape,
});

// Media file schemas
export const createMediaFileSchema = z.object({
  userId: z.string().cuid(),
  interactionId: z.string().cuid().optional(),
  memoryId: z.string().cuid().optional(),
  fileName: z.string().min(1).max(255),
  originalName: z.string().min(1).max(255),
  fileType: z.string().min(1).max(100),
  fileSize: z.number().int().min(1).max(100 * 1024 * 1024), // 100MB max
  s3Key: z.string().min(1).max(500),
  s3Url: z.string().url().max(1000),
  transcription: z.string().max(10000).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const updateMediaFileSchema = z.object({
  transcription: z.string().max(10000).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const getMediaFilesSchema = z.object({
  userId: z.string().cuid().optional(),
  fileType: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  ...paginationSchema.shape,
});

// Analytics schemas
export const createAnalyticsSchema = z.object({
  userId: z.string().cuid().optional(),
  eventType: z.string().min(1).max(100),
  eventData: z.record(z.string(), z.any()).optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().max(500).optional(),
});

export const getAnalyticsSchema = z.object({
  userId: z.string().cuid().optional(),
  eventType: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  ...paginationSchema.shape,
});

// WhatsApp webhook schemas
export const whatsAppWebhookSchema = z.object({
  Body: z.string().optional(),
  From: phoneNumberSchema,
  To: z.string().optional(),
  MessageSid: z.string().optional(),
  AccountSid: z.string().optional(),
  MessageStatus: z.enum(['sent', 'delivered', 'read', 'failed']).optional(),
  MediaUrl0: z.string().url().optional(),
  MediaUrl1: z.string().url().optional(),
  MediaUrl2: z.string().url().optional(),
  MediaUrl3: z.string().url().optional(),
  MediaUrl4: z.string().url().optional(),
  MediaUrl5: z.string().url().optional(),
  MediaUrl6: z.string().url().optional(),
  MediaUrl7: z.string().url().optional(),
  MediaUrl8: z.string().url().optional(),
  MediaUrl9: z.string().url().optional(),
  MediaContentType0: z.string().optional(),
  MediaContentType1: z.string().optional(),
  MediaContentType2: z.string().optional(),
  MediaContentType3: z.string().optional(),
  MediaContentType4: z.string().optional(),
  MediaContentType5: z.string().optional(),
  MediaContentType6: z.string().optional(),
  MediaContentType7: z.string().optional(),
  MediaContentType8: z.string().optional(),
  MediaContentType9: z.string().optional(),
  NumMedia: z.coerce.number().int().min(0).max(10).optional(),
  RecordingUrl: z.string().url().optional(),
  RecordingDuration: z.coerce.number().int().min(0).optional(),
  RecordingSid: z.string().optional(),
  Latitude: z.coerce.number().optional(),
  Longitude: z.coerce.number().optional(),
  Address: z.string().optional(),
  Label: z.string().optional(),
  DisplayName: z.string().optional(),
  ProfileName: z.string().optional(),
  WaId: z.string().optional(),
});

// File upload schemas
export const fileUploadSchema = z.object({
  userId: z.string().cuid(),
  interactionId: z.string().cuid().optional(),
  memoryId: z.string().cuid().optional(),
  file: z.any(), // Will be validated by multer
});

// Chat schemas
export const chatMessageSchema = z.object({
  userId: z.string().cuid(),
  message: z.string().min(1).max(1000),
  context: z.record(z.string(), z.any()).optional(),
});

export const chatResponseSchema = z.object({
  message: z.string().min(1).max(2000),
  memories: z.array(z.object({
    id: z.string().cuid(),
    content: z.string(),
    relevance: z.number().min(0).max(1),
  })).optional(),
  suggestions: z.array(z.string()).optional(),
});

// Export all schemas
export const schemas = {
  // Common
  pagination: paginationSchema,
  search: searchSchema,
  
  // User
  createUser: createUserSchema,
  updateUser: updateUserSchema,
  getUser: getUserSchema,
  
  // Interaction
  createInteraction: createInteractionSchema,
  updateInteraction: updateInteractionSchema,
  getInteractions: getInteractionsSchema,
  
  // Memory
  createMemory: createMemorySchema,
  updateMemory: updateMemorySchema,
  getMemories: getMemoriesSchema,
  searchMemories: searchMemoriesSchema,
  
  // Media File
  createMediaFile: createMediaFileSchema,
  updateMediaFile: updateMediaFileSchema,
  getMediaFiles: getMediaFilesSchema,
  
  // Analytics
  createAnalytics: createAnalyticsSchema,
  getAnalytics: getAnalyticsSchema,
  
  // WhatsApp
  whatsAppWebhook: whatsAppWebhookSchema,
  
  // File Upload
  fileUpload: fileUploadSchema,
  
  // Chat
  chatMessage: chatMessageSchema,
  chatResponse: chatResponseSchema,
};
