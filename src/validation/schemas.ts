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

// WhatsApp webhook schemas
export const whatsAppWebhookSchema = z.object({
  MessageSid: z.string(),
  From: z.string(),
  To: z.string(),
  Body: z.string().optional(),
  NumMedia: z.coerce.number().int().min(0).max(10).optional(),
  AccountSid: z.string().optional(),
  ApiVersion: z.string().optional(),
  Timestamp: z.string().optional(),
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
  MediaSid0: z.string().optional(),
  MediaSid1: z.string().optional(),
  MediaSid2: z.string().optional(),
  MediaSid3: z.string().optional(),
  MediaSid4: z.string().optional(),
  MediaSid5: z.string().optional(),
  MediaSid6: z.string().optional(),
  MediaSid7: z.string().optional(),
  MediaSid8: z.string().optional(),
  MediaSid9: z.string().optional(),
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
}).passthrough(); // Allow additional fields for testing

// Query message schema for testing
export const queryMessageSchema = z.object({
  userId: z.string().cuid(),
  query: z.string().min(1).max(500),
});

// Memory schemas for WhatsApp Memory Assistant
export const createMemorySchema = z.object({
  userId: z.string().cuid(),
  interactionId: z.string().cuid().optional(),
  content: z.string().min(1).max(10000),
  mem0Id: z.string().optional(),
  memoryType: z.enum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'MIXED']),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  importance: z.number().int().min(1).max(10).default(1),
  mediaUrls: z.array(z.string().url()).optional(),
  transcript: z.string().optional(),
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
  fileSize: z.number().int().min(1),
  s3Key: z.string().min(1).max(500),
  s3Url: z.string().url(),
  transcription: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const updateMediaFileSchema = z.object({
  transcription: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const getMediaFilesSchema = z.object({
  userId: z.string().cuid().optional(),
  interactionId: z.string().cuid().optional(),
  memoryId: z.string().cuid().optional(),
  fileType: z.string().optional(),
  ...paginationSchema.shape,
});

// Analytics schemas
export const createAnalyticsSchema = z.object({
  userId: z.string().cuid().optional(),
  eventType: z.string().min(1).max(100),
  eventData: z.record(z.string(), z.any()).optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

export const getAnalyticsSchema = z.object({
  userId: z.string().cuid().optional(),
  eventType: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  ...paginationSchema.shape,
});

// Reminder schemas
export const createReminderSchema = z.object({
  userId: z.string().cuid(),
  memoryId: z.string().cuid(),
  scheduledFor: z.string().datetime().optional(),
  naturalLanguageTime: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(1000),
  timezone: z.string().optional(),
}).refine(
  (data) => data.scheduledFor || data.naturalLanguageTime,
  {
    message: "Either scheduledFor or naturalLanguageTime must be provided",
    path: ["scheduledFor", "naturalLanguageTime"],
  }
);

export const getReminderSchema = z.object({
  userId: z.string().cuid(),
  status: z.enum(['PENDING', 'SENT', 'CANCELLED']).optional(),
  ...paginationSchema.shape,
});

export const cancelReminderSchema = z.object({
  id: z.string().cuid(),
});

// Memory sharing schemas
export const shareMemorySchema = z.object({
  memoryId: z.string().cuid(),
  fromUserId: z.string().cuid(),
  toPhoneNumber: z.string().min(10).max(15).regex(/^\+?[\d\s\-\(\)]+$/),
  message: z.string().max(500).optional(),
});

export const acceptShareSchema = z.object({
  toUserId: z.string().cuid(),
  copyToMyMemories: z.boolean().default(true),
});

export const rejectShareSchema = z.object({
  toUserId: z.string().cuid(),
});

export const respondToShareSchema = z.object({
  shareId: z.string().cuid(),
  userId: z.string().cuid(),
  action: z.enum(['accept', 'reject']),
  message: z.string().max(500).optional(),
});

export const getUserSharesSchema = z.object({
  userId: z.string().cuid(),
  type: z.enum(['sent', 'received', 'all']).default('all'),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional(),
});

// Export all schemas
export const schemas = {
  // Common
  pagination: paginationSchema,
  search: searchSchema,
  
  // WhatsApp
  whatsAppWebhook: whatsAppWebhookSchema,
  
  // Memory
  createMemory: createMemorySchema,
  searchMemories: searchMemoriesSchema,
  
  // Media File
  createMediaFile: createMediaFileSchema,
  updateMediaFile: updateMediaFileSchema,
  getMediaFiles: getMediaFilesSchema,
  
  // Analytics
  createAnalytics: createAnalyticsSchema,
  getAnalytics: getAnalyticsSchema,
  
  // Reminders
  createReminder: createReminderSchema,
  getReminder: getReminderSchema,
  cancelReminder: cancelReminderSchema,
  
  // Memory Sharing
  shareMemory: shareMemorySchema,
  acceptShare: acceptShareSchema,
  rejectShare: rejectShareSchema,
  respondToShare: respondToShareSchema,
  getUserShares: getUserSharesSchema,
};
