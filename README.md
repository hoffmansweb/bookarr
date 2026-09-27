# Bookarr - Book Management System

A full-featured book management application similar to Readarr, built with React frontend and Node.js backend.

## Features

### Core Features
- 📚 **Book Search & Discovery** - Search across Google Books, Open Library, and Goodreads
- 👤 **Author Monitoring** - Track your favorite authors for new releases
- 📖 **Personal Library** - Manage your book collection
- ⭐ **Favorites** - Star books yourself, or let a book star itself when you start reading or listening
- 🔔 **Real-time Notifications** - Get notified when monitored authors release new books
- 🎯 **Book Status Tracking** - Wanted, Available, Reading, Completed, Ignored
- 🔄 **Automated Metadata** - Fetch book details from multiple sources
- 📅 **Release Calendar** - Track upcoming releases

### Technical Features
- Multi-source book data aggregation (Google Books API, Open Library, Goodreads scraping)
- SQLite database (Sequelize ORM) — no database server to install
- JWT authentication
- Real-time updates via Socket.io
- Scheduled monitoring jobs with node-cron
- RESTful API architecture
- Responsive React UI with modern design

## Tech Stack

### Backend
- Node.js + Express
- SQLite + Sequelize (database file, no server)
- Google Books API
- Open Library API
- Goodreads web scraper (Cheerio)
- Socket.io for real-time updates
- JWT authentication
- Node-cron for scheduled tasks

### Frontend
- React 19
- React Router
- Axios for API calls
- Socket.io client
- React Query for data fetching
- React Toastify for notifications
- Modern CSS with dark theme

## Setup Instructions

### Prerequisites
- Node.js (v16 or higher)
- SQLite (bundled — the database file is created automatically)
- Google Books API key (optional but recommended)

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` file with your settings:
```
PORT=5000
JWT_SECRET=your_secret_key
GOOGLE_BOOKS_API_KEY=your_api_key
CLIENT_URL=http://localhost:3000
```

4. Start the backend server:
```bash
npm run dev
```

**Note:** The database will be created automatically if it doesn't exist!

The backend will run on http://localhost:5000

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install --legacy-peer-deps
```

3. Start the development server:
```bash
npm start
```

The frontend will run on http://localhost:3000

## Docker

One image runs the API and serves the built web UI, so there is a single port to open. The
SQLite database, JWT secret, logs and nightly backups live in the `bookarr_data` volume, and the
image already contains Chromium (Anna's Archive), ffmpeg, yt-dlp and Edge TTS — nothing else
needs to be installed on the host.

### Quick start

```bash
cp .env.docker .env      # set GITHUB_USER, DOWNLOAD_DIR, LIBRARY_DIR, BOOKARR_PORT, TZ (and PUID/PGID)

# Pull the published image...
docker compose up -d

# ...or build it from source instead:
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Open `http://<host>:5000`. **The first account you register becomes the admin**, which is what
you need to reach Settings. The stack also starts SearXNG (audiobook search) and FlareSolverr
(Anna's Archive), and `watchtower` updates the Bookarr container when a new `:latest` image is
published.

### Volumes

| Container path | Purpose |
| --- | --- |
| `/app/data` | SQLite database, JWT secret, rotating logs, nightly DB backups (`/app/data/backups`) |
| `/downloads` | Download/grab work space (`BOOKARR_WORK_DIR` defaults to `/downloads/.bookarr-work`) |
| `/library` | Your books — `/library/ebooks/<Author>/…`, `/library/audiobooks/<Author>/<Title>/…` |

Backing up `/app/data` (or just the database file inside it) captures everything, including the
API keys you entered in Settings.

### Environment variables (set them in `.env`)

| Variable | Default | Notes |
| --- | --- | --- |
| `GITHUB_USER` | – | Owner of the ghcr.io image you pull |
| `BOOKARR_PORT` | `5000` | Host port for the UI and API |
| `TZ` | `America/Chicago` | Container timezone; also drives job schedules |
| `DOWNLOAD_DIR` / `LIBRARY_DIR` | `./downloads`, `./library` | Host folders, used as the default `download_folder`, `ebooks_folder` and `audiobooks_folder` |
| `PUID` / `PGID` | unset (root) | Run as your host user (`id -u` / `id -g`) so new files aren't root-owned. Leave unset when the mounted folders are root-only |
| `JWT_SECRET` | generated | Created once and kept in the data volume |
| `GOOGLE_BOOKS_API_KEY` | – | Optional; raises the metadata quota |
| `KOKORO_URL` | – | Optional OpenAI-compatible TTS server (Kokoro-FastAPI, openedai-speech…); blank uses the built-in Edge TTS voices |
| `SEARXNG_SECRET` | placeholder | Generate with `openssl rand -hex 32` |
| `UPDATE_INTERVAL` | `300` | Watchtower poll interval in seconds |

Settings saved in the UI always win over the environment: the variables above are only defaults,
and they are what a fresh container displays on the Settings page.

### Operating the container

```bash
docker compose logs -f bookarr                   # follow the logs
docker compose pull && docker compose up -d      # update manually
docker compose exec bookarr node makeAdmin.js    # promote the oldest account to admin
docker compose exec bookarr sh                   # shell inside the container
```

### Good to know

- Chromium runs headless, so the interactive Amazon sign-in flow (which opens a visible browser
  window) can't be completed inside the container.
- `.env` files, source maps and the local `backend/backups/*.sqlite` snapshots are excluded from
  the build, so neither your keys nor your library data end up in the image.
- Images are published to `ghcr.io/<owner>/bookarr:latest` by the `Build and Push Docker Image`
  workflow on pushes to `main`. Run that workflow manually (`platforms` input) to also build
  `linux/arm64`.

## Usage

1. **Register/Login** - Create an account or login
2. **Search Books** - Use the search feature to find books from multiple sources
3. **Add Books** - Add books to your library with different statuses
4. **Monitor Authors** - Enable monitoring for authors to track new releases
5. **Get Notifications** - Receive real-time notifications for new book releases
6. **Manage Library** - Track your reading progress and organize your collection

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/profile` - Get user profile

### Books
- `GET /api/books/search?query=` - Search books across all sources
- `GET /api/books` - Get all books (with filters)
- `GET /api/books/:id` - Get book details
- `POST /api/books` - Create book
- `PUT /api/books/:id` - Update book
- `DELETE /api/books/:id` - Delete book
- `POST /api/books/:id/library` - Add book to library
- `GET /api/books/library` - Get user's library

### Authors
- `GET /api/authors` - Get all authors
- `GET /api/authors/:id` - Get author details
- `POST /api/authors` - Create author
- `PUT /api/authors/:id` - Update author
- `DELETE /api/authors/:id` - Delete author
- `POST /api/authors/:id/monitor` - Monitor author
- `DELETE /api/authors/:id/monitor` - Unmonitor author
- `GET /api/authors/monitored` - Get monitored authors
- `POST /api/authors/:id/refresh` - Refresh author's books

### Notifications
- `GET /api/notifications` - Get notifications
- `PUT /api/notifications/:id/read` - Mark as read
- `PUT /api/notifications/read-all` - Mark all as read
- `DELETE /api/notifications/:id` - Delete notification

## Monitoring System

The application includes an automated monitoring system that:
- Runs every 6 hours (configurable via `MONITOR_CHECK_INTERVAL`)
- Checks all monitored authors for new releases
- Compares with existing books in the database
- Creates notifications for new books
- Enriches book data from multiple sources

## Data Sources

1. **Google Books API** - Primary source for book metadata (shared daily quota; a key in
   Settings → General → Metadata raises it and the source can be switched off there)
2. **Open Library** - Additional book data and author information
3. **Goodreads** - Book ratings and reviews (via web scraping)

## Project Structure

```
Bookarr/
├── backend/
│   ├── src/
│   │   ├── config/         # Database, logger configuration
│   │   ├── controllers/    # Route controllers
│   │   ├── models/         # Sequelize models
│   │   ├── routes/         # API routes
│   │   ├── services/       # External API services
│   │   ├── scrapers/       # Web scrapers
│   │   ├── jobs/           # Scheduled jobs
│   │   ├── middleware/     # Auth middleware
│   │   └── server.js       # Main server file
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── components/     # React components
    │   ├── pages/          # Page components
    │   ├── context/        # React context
    │   ├── services/       # API services
    │   └── App.js          # Main app component
    └── package.json
```

## Development

### Backend Development
```bash
cd backend
npm run dev  # Uses nodemon for auto-reload
```

### Frontend Development
```bash
cd frontend
npm start  # React development server
```

## Production Build

### Backend
```bash
cd backend
npm start
```

### Frontend
```bash
cd frontend
npm run build
```

## Future Enhancements

- [ ] Book recommendations based on reading history
- [ ] Import/export library data
- [ ] Advanced search filters
- [ ] Reading statistics and analytics
- [ ] Book series tracking
- [ ] Integration with more book sources
- [ ] Mobile app
- [x] Docker containerization (single image + compose)
- [ ] Email notifications
- [ ] Social features (share lists, reviews)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
