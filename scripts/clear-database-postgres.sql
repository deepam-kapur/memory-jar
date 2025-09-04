-- Clear PostgreSQL Database Script - Truncate all tables
-- This script will remove all data from all tables while preserving the schema

-- Truncate all tables with CASCADE to handle foreign key constraints
-- RESTART IDENTITY resets auto-increment sequences
TRUNCATE TABLE 
  shared_memories, 
  reminders, 
  analytics, 
  media_files, 
  memories, 
  interactions, 
  users 
RESTART IDENTITY CASCADE;

-- Verify tables are empty
SELECT 'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'interactions', COUNT(*) FROM interactions
UNION ALL
SELECT 'memories', COUNT(*) FROM memories
UNION ALL
SELECT 'media_files', COUNT(*) FROM media_files
UNION ALL
SELECT 'analytics', COUNT(*) FROM analytics
UNION ALL
SELECT 'reminders', COUNT(*) FROM reminders
UNION ALL
SELECT 'shared_memories', COUNT(*) FROM shared_memories;
