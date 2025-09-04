-- Clear Database Script - Truncate all tables
-- This script will remove all data from all tables while preserving the schema

-- Disable foreign key constraints temporarily
PRAGMA foreign_keys = OFF;

-- Delete all data from tables (in proper order to avoid foreign key conflicts)
DELETE FROM shared_memories;
DELETE FROM reminders;
DELETE FROM analytics;
DELETE FROM media_files;
DELETE FROM memories;
DELETE FROM interactions;
DELETE FROM users;

-- Reset auto-increment sequences
DELETE FROM sqlite_sequence WHERE name IN (
  'users',
  'interactions', 
  'memories',
  'media_files',
  'analytics',
  'reminders',
  'shared_memories'
);

-- Re-enable foreign key constraints
PRAGMA foreign_keys = ON;

-- Vacuum to reclaim space
VACUUM;

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
