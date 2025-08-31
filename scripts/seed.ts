import { PrismaClient, MessageType, Direction, InteractionStatus, MemoryType } from '../src/generated/prisma';
import { env } from '../src/config/environment';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Clear existing data
  await prisma.analytics.deleteMany();
  await prisma.mediaFile.deleteMany();
  await prisma.memory.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.user.deleteMany();

  console.log('🧹 Cleared existing data');

  // Create sample users
  const user1 = await prisma.user.create({
    data: {
      phoneNumber: '+1234567890',
      name: 'John Doe',
    },
  });

  const user2 = await prisma.user.create({
    data: {
      phoneNumber: '+0987654321',
      name: 'Jane Smith',
    },
  });

  console.log('👥 Created sample users');

  // Create sample interactions
  const interaction1 = await prisma.interaction.create({
    data: {
      userId: user1.id,
      messageType: MessageType.TEXT,
      content: 'Hello! I want to remember that I have a meeting tomorrow at 2 PM.',
      direction: Direction.INBOUND,
      status: InteractionStatus.PROCESSED,
      metadata: {
        messageId: 'msg_123',
        timestamp: new Date().toISOString(),
      },
    },
  });

  const interaction2 = await prisma.interaction.create({
    data: {
      userId: user1.id,
      messageType: MessageType.IMAGE,
      content: 'Photo of my new car',
      direction: Direction.INBOUND,
      status: InteractionStatus.PROCESSED,
      metadata: {
        messageId: 'msg_124',
        timestamp: new Date().toISOString(),
      },
    },
  });

  const interaction3 = await prisma.interaction.create({
    data: {
      userId: user2.id,
      messageType: MessageType.AUDIO,
      content: 'Voice note about project ideas',
      direction: Direction.INBOUND,
      status: InteractionStatus.PROCESSED,
      metadata: {
        messageId: 'msg_125',
        timestamp: new Date().toISOString(),
      },
    },
  });

  console.log('💬 Created sample interactions');

  // Create sample memories
  const memory1 = await prisma.memory.create({
    data: {
      userId: user1.id,
      interactionId: interaction1.id,
      content: 'Meeting tomorrow at 2 PM',
      mem0Id: 'mem_001',
      memoryType: MemoryType.TEXT,
      tags: ['meeting', 'work', 'schedule'],
      importance: 8,
    },
  });

  const memory2 = await prisma.memory.create({
    data: {
      userId: user1.id,
      interactionId: interaction2.id,
      content: 'New car purchase - red Tesla Model 3',
      mem0Id: 'mem_002',
      memoryType: MemoryType.IMAGE,
      tags: ['car', 'purchase', 'tesla'],
      importance: 9,
    },
  });

  const memory3 = await prisma.memory.create({
    data: {
      userId: user2.id,
      interactionId: interaction3.id,
      content: 'Project ideas for mobile app development',
      mem0Id: 'mem_003',
      memoryType: MemoryType.AUDIO,
      tags: ['project', 'ideas', 'mobile', 'app'],
      importance: 7,
    },
  });

  console.log('🧠 Created sample memories');

  // Create sample media files
  const mediaFile1 = await prisma.mediaFile.create({
    data: {
      userId: user1.id,
      interactionId: interaction2.id,
      memoryId: memory2.id,
      fileName: 'car_photo.jpg',
      originalName: 'IMG_2024_01_15.jpg',
      fileType: 'image/jpeg',
      fileSize: 2048576, // 2MB
      storageKey: 'uploads/user1/car_photo.jpg',
      storageUrl: 'https://s3.amazonaws.com/memory-jar/uploads/user1/car_photo.jpg',
      metadata: {
        width: 1920,
        height: 1080,
        location: 'San Francisco, CA',
      },
    },
  });

  const mediaFile2 = await prisma.mediaFile.create({
    data: {
      userId: user2.id,
      interactionId: interaction3.id,
      memoryId: memory3.id,
      fileName: 'voice_note.m4a',
      originalName: 'Voice_Note_001.m4a',
      fileType: 'audio/mp4',
      fileSize: 1048576, // 1MB
      storageKey: 'uploads/user2/voice_note.m4a',
      storageUrl: 'https://s3.amazonaws.com/memory-jar/uploads/user2/voice_note.m4a',
      transcription: 'This is a transcription of the voice note about project ideas.',
      metadata: {
        duration: 30, // seconds
        sampleRate: 44100,
      },
    },
  });

  console.log('📁 Created sample media files');

  // Create sample analytics
  await prisma.analytics.createMany({
    data: [
      {
        userId: user1.id,
        eventType: 'memory_created',
        eventData: { memoryId: memory1.id, memoryType: 'TEXT' },
        ipAddress: '192.168.1.1',
        userAgent: 'WhatsApp/2.22.1',
      },
      {
        userId: user1.id,
        eventType: 'file_uploaded',
        eventData: { fileId: mediaFile1.id, fileType: 'image/jpeg' },
        ipAddress: '192.168.1.1',
        userAgent: 'WhatsApp/2.22.1',
      },
      {
        userId: user2.id,
        eventType: 'memory_created',
        eventData: { memoryId: memory3.id, memoryType: 'AUDIO' },
        ipAddress: '192.168.1.2',
        userAgent: 'WhatsApp/2.22.1',
      },
      {
        userId: user1.id,
        eventType: 'memory_retrieved',
        eventData: { memoryId: memory1.id, query: 'meeting tomorrow' },
        ipAddress: '192.168.1.1',
        userAgent: 'WhatsApp/2.22.1',
      },
    ],
  });

  console.log('📊 Created sample analytics');

  console.log('✅ Database seeding completed successfully!');
  console.log(`📈 Created ${await prisma.user.count()} users`);
  console.log(`💬 Created ${await prisma.interaction.count()} interactions`);
  console.log(`🧠 Created ${await prisma.memory.count()} memories`);
  console.log(`📁 Created ${await prisma.mediaFile.count()} media files`);
  console.log(`📊 Created ${await prisma.analytics.count()} analytics events`);
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

