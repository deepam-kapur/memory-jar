-- CreateEnum
CREATE TYPE "public"."MessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'LOCATION', 'CONTACT');

-- CreateEnum
CREATE TYPE "public"."Direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "public"."InteractionStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "public"."MemoryType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'MIXED');

-- CreateEnum
CREATE TYPE "public"."ReminderStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."SharedMemoryStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."interactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageSid" TEXT,
    "messageType" "public"."MessageType" NOT NULL,
    "content" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" "public"."Direction" NOT NULL,
    "status" "public"."InteractionStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."memories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "interactionId" TEXT,
    "content" TEXT NOT NULL,
    "mem0Id" TEXT,
    "memoryType" "public"."MemoryType" NOT NULL,
    "tags" JSONB NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastAccessed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accessCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."media_files" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "interactionId" TEXT,
    "memoryId" TEXT,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "s3Url" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "transcription" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."analytics" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventData" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reminders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "message" TEXT NOT NULL,
    "status" "public"."ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."shared_memories" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "message" TEXT,
    "status" "public"."SharedMemoryStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneNumber_key" ON "public"."users"("phoneNumber");

-- CreateIndex
CREATE INDEX "users_phoneNumber_idx" ON "public"."users"("phoneNumber");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "public"."users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "interactions_messageSid_key" ON "public"."interactions"("messageSid");

-- CreateIndex
CREATE INDEX "interactions_userId_idx" ON "public"."interactions"("userId");

-- CreateIndex
CREATE INDEX "interactions_timestamp_idx" ON "public"."interactions"("timestamp");

-- CreateIndex
CREATE INDEX "interactions_messageType_idx" ON "public"."interactions"("messageType");

-- CreateIndex
CREATE INDEX "interactions_direction_idx" ON "public"."interactions"("direction");

-- CreateIndex
CREATE INDEX "interactions_status_idx" ON "public"."interactions"("status");

-- CreateIndex
CREATE INDEX "memories_userId_idx" ON "public"."memories"("userId");

-- CreateIndex
CREATE INDEX "memories_mem0Id_idx" ON "public"."memories"("mem0Id");

-- CreateIndex
CREATE INDEX "memories_memoryType_idx" ON "public"."memories"("memoryType");

-- CreateIndex
CREATE INDEX "memories_tags_idx" ON "public"."memories"("tags");

-- CreateIndex
CREATE INDEX "memories_importance_idx" ON "public"."memories"("importance");

-- CreateIndex
CREATE INDEX "memories_createdAt_idx" ON "public"."memories"("createdAt");

-- CreateIndex
CREATE INDEX "memories_lastAccessed_idx" ON "public"."memories"("lastAccessed");

-- CreateIndex
CREATE UNIQUE INDEX "media_files_fingerprint_key" ON "public"."media_files"("fingerprint");

-- CreateIndex
CREATE INDEX "media_files_userId_idx" ON "public"."media_files"("userId");

-- CreateIndex
CREATE INDEX "media_files_fileType_idx" ON "public"."media_files"("fileType");

-- CreateIndex
CREATE INDEX "media_files_createdAt_idx" ON "public"."media_files"("createdAt");

-- CreateIndex
CREATE INDEX "media_files_s3Key_idx" ON "public"."media_files"("s3Key");

-- CreateIndex
CREATE INDEX "analytics_userId_idx" ON "public"."analytics"("userId");

-- CreateIndex
CREATE INDEX "analytics_eventType_idx" ON "public"."analytics"("eventType");

-- CreateIndex
CREATE INDEX "analytics_timestamp_idx" ON "public"."analytics"("timestamp");

-- CreateIndex
CREATE INDEX "reminders_userId_idx" ON "public"."reminders"("userId");

-- CreateIndex
CREATE INDEX "reminders_scheduledFor_idx" ON "public"."reminders"("scheduledFor");

-- CreateIndex
CREATE INDEX "shared_memories_memoryId_idx" ON "public"."shared_memories"("memoryId");

-- CreateIndex
CREATE INDEX "shared_memories_fromUserId_idx" ON "public"."shared_memories"("fromUserId");

-- CreateIndex
CREATE INDEX "shared_memories_toUserId_idx" ON "public"."shared_memories"("toUserId");

-- AddForeignKey
ALTER TABLE "public"."interactions" ADD CONSTRAINT "interactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memories" ADD CONSTRAINT "memories_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "public"."interactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memories" ADD CONSTRAINT "memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_files" ADD CONSTRAINT "media_files_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "public"."memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_files" ADD CONSTRAINT "media_files_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "public"."interactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."media_files" ADD CONSTRAINT "media_files_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reminders" ADD CONSTRAINT "reminders_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "public"."memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reminders" ADD CONSTRAINT "reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shared_memories" ADD CONSTRAINT "shared_memories_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shared_memories" ADD CONSTRAINT "shared_memories_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shared_memories" ADD CONSTRAINT "shared_memories_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "public"."memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
