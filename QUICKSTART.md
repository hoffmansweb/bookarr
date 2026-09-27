# Bookarr - Quick Start Guide

## Prerequisites
- Node.js v16+ installed
- SQLite (bundled — the database file is created automatically)
- Git (optional)

## Installation (3 minutes)

### Step 1: Backend Setup
```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Configure environment (already created with defaults)
# Edit .env file if needed:
# - Add GOOGLE_BOOKS_API_KEY (optional but recommended)
# - Set JWT_SECRET to any random string

# Start backend server (database will be created automatically)
npm run dev
```

Backend will run on http://localhost:5000

**Note:** The database will be created automatically when you start the backend!

### Step 2: Frontend Setup
```bash
# Open a new terminal
# Navigate to frontend
cd frontend

# Install dependencies
npm install --legacy-peer-deps

# Start frontend server
npm start
```

Frontend will open automatically at http://localhost:3000

## First Use

1. **Register Account**
   - Go to http://localhost:3000
   - Click "Register"
   - Create your account

2. **Search for Books**
   - Click "Books" in navigation
   - Use search bar to find books
   - Books will be searched across Google Books, Open Library, and Goodreads

3. **Add Books**
   - Click on a book from search results
   - Select status (Wanted, Available, Reading, etc.)
   - Add to your library

4. **Monitor Authors**
   - Click "Authors" in navigation
   - Search for an author
   - Click "Monitor" button
   - You'll get notifications when they release new books

5. **Check Notifications**
   - Click the bell icon in top right
   - View new book release notifications
   - Mark as read or dismiss

## Common Tasks

### Get Google Books API Key (Recommended)
1. Go to https://console.cloud.google.com/
2. Create a new project
3. Enable "Books API"
4. Create credentials (API Key)
5. Add key to `backend/.env`:
   ```
   GOOGLE_BOOKS_API_KEY=your_key_here
   ```
6. Restart backend server

### Change Monitoring Frequency
Edit `backend/.env`:
```bash
# Check every 3 hours instead of 6
MONITOR_CHECK_INTERVAL=0 */3 * * *

# Check daily at midnight
MONITOR_CHECK_INTERVAL=0 0 * * *

# Check every hour
MONITOR_CHECK_INTERVAL=0 * * * *
```

### Using Docker (Alternative Setup)
```bash
# From the project root - see README.md -> Docker for the full guide
cp .env.docker .env      # set GITHUB_USER, DOWNLOAD_DIR, LIBRARY_DIR, TZ (and PUID/PGID)
docker compose up -d     # or: docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

# Access at:
# Web UI + API: http://localhost:5000
# The first account you register becomes the admin, so register before configuring anything.
```

## Troubleshooting

### Backend won't start
- Check the port is free (`netstat -ano | findstr :5000`; in Docker: change `BOOKARR_PORT`)
- Check `.env` has a `JWT_SECRET` and the right `PORT`
- Look at logs in `backend/logs/` (Docker: `docker compose logs -f bookarr`)
- The database is a SQLite file created automatically at `backend/database.sqlite`
  (Docker: `/app/data/database.sqlite` inside the data volume)

### Frontend won't start
- Clear node_modules: `rm -rf node_modules && npm install --legacy-peer-deps`
- Check backend is running on port 5000
- Verify .env has correct API URL

### No search results
- Add Google Books API key to backend/.env
- Check internet connection
- Look at backend console for errors
- Try different search terms

### Monitoring not working
- Check cron schedule in backend/.env
- Verify authors are marked as "monitored"
- Check backend logs for errors
- Wait for next scheduled run (default: 6 hours)

## Project Structure
```
Bookarr/
├── backend/          # Node.js/Express API
│   ├── src/
│   │   ├── controllers/   # Request handlers
│   │   ├── models/        # Database models
│   │   ├── routes/        # API routes
│   │   ├── services/      # External APIs
│   │   ├── scrapers/      # Web scrapers
│   │   └── jobs/          # Scheduled tasks
│   └── .env          # Configuration
│
└── frontend/         # React application
    ├── src/
    │   ├── components/    # UI components
    │   ├── pages/         # Page components
    │   ├── context/       # State management
    │   └── services/      # API calls
    └── .env          # Configuration
```

## Key Features

✅ Multi-source book search (Google Books, Open Library, Goodreads)
✅ Author monitoring with automatic new release detection
✅ Personal library management
✅ Real-time notifications
✅ Book status tracking (Wanted, Reading, Completed, etc.)
✅ Automated metadata enrichment
✅ Dark theme UI
✅ RESTful API
✅ JWT authentication

## Next Steps

- Read [FEATURES.md](FEATURES.md) for complete feature list
- Read [README.md](README.md) for detailed documentation
- Check API endpoints in README
- Customize monitoring schedule
- Add more authors to monitor
- Build your library!

## Support

For issues or questions:
1. Check the logs in `backend/logs/`
2. Review the README.md
3. Check environment configuration
4. Verify all services are running

## Quick Commands

```bash
# Setup database manually (optional - auto-created on start)
cd backend && npm run setup-db

# Start backend (development)
cd backend && npm run dev

# Start frontend (development)
cd frontend && npm start

# Start backend (production)
cd backend && npm start

# Build frontend (production)
cd frontend && npm run build

# Docker (all services)
docker compose up -d

# View logs
tail -f backend/logs/combined.log        # native install
docker compose logs -f bookarr           # Docker
```

Enjoy using Bookarr! 📚
