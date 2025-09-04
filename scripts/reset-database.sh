#!/bin/bash

# Reset Database Script - Clear all data and media files
# This script completely resets the database and storage for fresh testing

set -e  # Exit on any error

echo "🗄️  Resetting WhatsApp Memory Assistant database..."

# Check if database configuration exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Run setup first: ./scripts/setup-local-db.sh"
    exit 1
fi

# Clear all database tables
echo "🧹 Clearing all database tables..."

# Check if using PostgreSQL or SQLite
if grep -q "postgresql://" .env 2>/dev/null; then
    echo "📊 Using PostgreSQL database"
    DB_URL=$(grep DATABASE_URL .env | cut -d '"' -f 2)
    psql "$DB_URL" -c "TRUNCATE TABLE shared_memories, reminders, analytics, media_files, memories, interactions, users RESTART IDENTITY CASCADE;"
elif [ -f "prisma/prisma/dev.db" ]; then
    echo "📊 Using SQLite database"
    sqlite3 prisma/prisma/dev.db "
    PRAGMA foreign_keys = OFF;
    DELETE FROM shared_memories;
    DELETE FROM reminders;
    DELETE FROM analytics;
    DELETE FROM media_files;
    DELETE FROM memories;
    DELETE FROM interactions;
    DELETE FROM users;
    PRAGMA foreign_keys = ON;
    VACUUM;
    "
else
    echo "❌ Cannot detect database type or database not found"
    exit 1
fi

# Clear media storage
echo "📁 Clearing media storage..."
rm -rf storage/media/* 2>/dev/null || true
mkdir -p storage/media/{images,audio,video,documents} 2>/dev/null || true

# Verify database is empty
echo "✅ Verifying database is empty..."
if grep -q "postgresql://" .env 2>/dev/null; then
    DB_URL=$(grep DATABASE_URL .env | cut -d '"' -f 2)
    TOTAL_ROWS=$(psql "$DB_URL" -t -c "
    SELECT 
      (SELECT COUNT(*) FROM users) +
      (SELECT COUNT(*) FROM interactions) +
      (SELECT COUNT(*) FROM memories) +
      (SELECT COUNT(*) FROM media_files) +
      (SELECT COUNT(*) FROM analytics) +
      (SELECT COUNT(*) FROM reminders) +
      (SELECT COUNT(*) FROM shared_memories);
    " | xargs)
else
    TOTAL_ROWS=$(sqlite3 prisma/prisma/dev.db "
    SELECT 
      (SELECT COUNT(*) FROM users) +
      (SELECT COUNT(*) FROM interactions) +
      (SELECT COUNT(*) FROM memories) +
      (SELECT COUNT(*) FROM media_files) +
      (SELECT COUNT(*) FROM analytics) +
      (SELECT COUNT(*) FROM reminders) +
      (SELECT COUNT(*) FROM shared_memories);
    ")
fi

if [ "$TOTAL_ROWS" -eq 0 ]; then
    echo "🎉 Database successfully reset!"
    echo "📊 All tables are empty (0 rows total)"
    echo "📁 Media storage cleared"
    echo ""
    echo "🚀 Ready for fresh testing!"
    echo "   - Start server: npm start"
    echo "   - Send WhatsApp messages to populate data"
    echo "   - Check health: curl http://localhost:3000/health"
else
    echo "⚠️  Warning: Database may not be completely empty ($TOTAL_ROWS rows remaining)"
fi

echo ""
