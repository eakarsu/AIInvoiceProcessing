#!/bin/bash
set -e

echo "=========================================="
echo "  AI Invoice Processing & AP Automation"
echo "=========================================="
echo ""

# Load env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

BACKEND_PORT=${BACKEND_PORT:-4001}
FRONTEND_PORT=${FRONTEND_PORT:-3001}

# Kill any processes using our ports
echo "🧹 Cleaning up used ports..."
for PORT in $BACKEND_PORT $FRONTEND_PORT; do
  PID=$(lsof -ti:$PORT 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo "   Killing process on port $PORT (PID: $PID)"
    kill -9 $PID 2>/dev/null || true
    sleep 1
  fi
done

echo "✅ Ports cleared"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install --silent 2>&1 | tail -1
echo "✅ Dependencies installed"
echo ""

# Create database if not exists
echo "🗄️  Setting up database..."
psql -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME:-ai_invoice_processing}'" | grep -q 1 || \
  psql -d postgres -c "CREATE DATABASE ${DB_NAME:-ai_invoice_processing}"
echo "✅ Database ready"
echo ""

# Seed data
echo "🌱 Seeding database with sample data..."
node server/seed.js
echo ""

# Start backend with file watching (auto-reload on changes)
echo "🚀 Starting backend server on port $BACKEND_PORT (with auto-reload)..."
node --watch server/index.js &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"
echo ""

# Wait for backend to start
sleep 2

echo "=========================================="
echo "  🎉 Application is running!"
echo ""
echo "  🌐 App:     http://localhost:$BACKEND_PORT"
echo ""
echo "  📧 Demo Login:"
echo "     Email:    admin@company.com"
echo "     Password: admin123"
echo ""
echo "  🔄 Auto-reload is enabled"
echo "     Edit server files and changes"
echo "     will be picked up automatically."
echo ""
echo "  Press Ctrl+C to stop"
echo "=========================================="

# Handle shutdown
trap "echo ''; echo '🛑 Shutting down...'; kill $BACKEND_PID 2>/dev/null; echo '✅ Stopped'; exit 0" SIGINT SIGTERM

# Keep script running
wait $BACKEND_PID
