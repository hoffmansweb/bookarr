# Bookarr - Complete Features List

## 🎯 Core Features

### 1. User Management
- **User Registration & Authentication**
  - Secure JWT-based authentication
  - Password hashing with bcrypt
  - Role-based access control (admin/user)
  - User profile management

### 2. Book Management
- **Multi-Source Book Search**
  - Google Books API integration
  - Open Library API integration
  - Goodreads web scraping
  - Aggregated search results from all sources
  - Automatic deduplication

- **Book Status Tracking**
  - Wanted - Books you want to acquire
  - Available - Books you have access to
  - Reading - Currently reading
  - Completed - Finished reading
  - Ignored - Books you're not interested in

- **Book Metadata**
  - Title, subtitle, description
  - ISBN-10 and ISBN-13
  - Publication date and publisher
  - Page count and language
  - Cover images
  - Ratings and review counts
  - Series information
  - Multiple author support

- **Personal Library**
  - Add books to your personal collection
  - Track reading progress
  - Filter and search your library
  - Update book status

### 3. Author Monitoring
- **Author Tracking**
  - Monitor favorite authors
  - Automatic new release detection
  - Author biography and metadata
  - Author image support
  - Track multiple external IDs (Goodreads, Google Books)

- **Automated Monitoring System**
  - Scheduled checks every 6 hours (configurable)
  - Compares new releases against existing database
  - Enriches book data from multiple sources
  - Creates notifications for new releases
  - Tracks last check timestamp

- **Author Management**
  - Add/remove authors
  - Enable/disable monitoring per author
  - Manual refresh of author's books
  - View all books by author

### 4. Notification System
- **Real-Time Notifications**
  - Socket.io integration for instant updates
  - New book release notifications
  - Author update notifications
  - System notifications

- **Notification Management**
  - Mark individual notifications as read
  - Mark all notifications as read
  - Delete notifications
  - Filter by read/unread status
  - Notification badge counter

### 5. Search & Discovery
- **Advanced Search**
  - Search across all data sources simultaneously
  - Search by title, author, ISBN
  - Filter results by status
  - Filter by monitored authors
  - Real-time search results

- **Book Discovery**
  - Browse all books in database
  - Filter by status (wanted, available, etc.)
  - Search within your library
  - View recent additions

### 6. Data Aggregation
- **Multi-Source Data Enrichment**
  - Combines data from Google Books, Open Library, and Goodreads
  - Fills missing metadata from multiple sources
  - Prioritizes most complete information
  - Handles API failures gracefully

- **Intelligent Deduplication**
  - Matches books by ISBN
  - Falls back to title matching
  - Merges duplicate entries
  - Preserves best available data

## 🔧 Technical Features

### Backend Architecture
- **RESTful API**
  - Express.js framework
  - Modular route structure
  - Controller-based architecture
  - Middleware for authentication

- **Database**
  - SQLite with Sequelize ORM (single file in the data volume — no separate server)
  - Relational data model
  - JSON metadata stored in text columns
  - Proper indexing and relationships
  - Many-to-many relationships for users/books/authors

- **External Integrations**
  - Google Books API client
  - Open Library API client
  - Goodreads web scraper with rate limiting
  - Configurable retry logic
  - Error handling and logging

- **Background Jobs**
  - Node-cron for scheduled tasks
  - Monitoring job for author updates
  - Configurable intervals
  - Automatic error recovery

- **Security**
  - JWT token authentication
  - Password hashing
  - Request validation
  - CORS configuration
  - Rate limiting ready

- **Logging**
  - Winston logger
  - File-based logging
  - Console logging in development
  - Error tracking
  - Request logging

### Frontend Architecture
- **React Application**
  - React 19
  - Functional components with hooks
  - Context API for state management
  - React Router for navigation

- **State Management**
  - Auth context for user state
  - Socket context for real-time updates
  - React Query for server state
  - Local state for UI

- **Real-Time Updates**
  - Socket.io client integration
  - Automatic notification updates
  - Connection management
  - Reconnection handling

- **API Integration**
  - Axios HTTP client
  - Centralized API service
  - Request/response interceptors
  - Automatic token injection
  - Error handling

- **UI/UX**
  - Modern dark theme design
  - Responsive grid layouts
  - Card-based components
  - Toast notifications
  - Loading states
  - Empty states
  - Hover effects and transitions

## 📊 Data Models

### User Model
- UUID primary key
- Username, email, password
- Role (admin/user)
- Timestamps
- Relationships: books, authors, notifications

### Author Model
- UUID primary key
- Name, bio, image
- External IDs (Goodreads, Google Books)
- Website URL
- Monitored status
- Last checked timestamp
- Flexible JSON metadata
- Relationships: books, followers

### Book Model
- UUID primary key
- Title, subtitle, description
- ISBN-10, ISBN-13
- Publication date, publisher
- Page count, language
- Cover image URL
- External IDs
- Rating and ratings count
- Status (wanted/available/reading/completed/ignored)
- Monitored status
- Series information
- Arrival timestamp (importedAt - when the file landed in the library)
- Flexible JSON metadata
- Relationships: author, users

### Notification Model
- UUID primary key
- Type (new_book/author_update/system)
- Title and message
- Read status
- Flexible JSON metadata
- Timestamps
- Relationships: user

## 🚀 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/profile` - Get current user profile

### Books
- `GET /api/books/search` - Search books across all sources
- `GET /api/books` - Get all books with filters
- `GET /api/books/:id` - Get single book
- `POST /api/books` - Create new book
- `PUT /api/books/:id` - Update book
- `DELETE /api/books/:id` - Delete book
- `POST /api/books/:id/library` - Add book to user library
- `GET /api/books/library` - Get user's library
- `GET /api/books/recent-arrivals` - Newest arrivals for the dashboard row (`?limit=&days=`)

### Authors
- `GET /api/authors` - Get all authors with filters
- `GET /api/authors/:id` - Get single author
- `POST /api/authors` - Create new author
- `PUT /api/authors/:id` - Update author
- `DELETE /api/authors/:id` - Delete author
- `POST /api/authors/:id/monitor` - Start monitoring author
- `DELETE /api/authors/:id/monitor` - Stop monitoring author
- `GET /api/authors/monitored` - Get user's monitored authors
- `POST /api/authors/:id/refresh` - Manually refresh author's books

### Notifications
- `GET /api/notifications` - Get user's notifications
- `PUT /api/notifications/:id/read` - Mark notification as read
- `PUT /api/notifications/read-all` - Mark all as read
- `DELETE /api/notifications/:id` - Delete notification

## 🎨 UI Components

### Pages
- **Login/Register** - Authentication pages
- **Dashboard** - New arrivals, continue reading/listening, favorites
- **Books** - Browse and manage all books
- **Authors** - Browse and manage authors
- **Library** - Personal book collection

### Components
- **Navbar** - Navigation with notifications dropdown
- **BookCard** - Display book with actions
- **AuthorCard** - Display author with monitoring controls
- **SearchBar** - Reusable search component
- **PrivateRoute** - Protected route wrapper

## 🔄 Automated Workflows

### Monitoring Job
1. Runs on configurable schedule (default: every 6 hours)
2. Fetches all monitored authors from database
3. For each author:
   - Searches for books across all sources
   - Compares with existing books (by ISBN)
   - Identifies new releases
   - Enriches new book data
   - Creates book records
   - Generates notifications for followers
   - Updates last checked timestamp
4. Includes rate limiting and error handling

### Data Enrichment
1. Initial book data from search
2. Fetch additional data by ISBN from Google Books
3. Fetch additional data by ISBN from Open Library
4. Fetch additional data by ID from Goodreads
5. Merge all data sources
6. Fill missing fields with best available data
7. Store enriched book record

## 🛠️ Configuration

### Environment Variables
- Database connection settings
- JWT secret and expiration
- API keys (Google Books)
- Scraper settings (user agent, delays, retries)
- Monitoring schedule (cron expression)
- CORS settings

### Customization
- Monitoring check interval
- Scraper delay between requests
- Maximum retry attempts
- Results per page
- Token expiration time

## 📦 Deployment Options

### Development
- Separate backend and frontend servers
- Hot reload for both
- Development logging
- CORS enabled

### Production
- Docker Compose setup included
- Single image: API and the built web UI together (Node 22, Chromium, ffmpeg, yt-dlp, Edge TTS)
- Optional SearXNG, FlareSolverr and Watchtower sidecars
- Volume persistence (database, downloads, library)
- Environment configuration

### Docker
- `docker compose up -d` from the repository root (pull the image, or build with docker-compose.build.yml)
- SQLite database created automatically in the data volume
- Private compose network — no database server, nothing else to install
- PUID/PGID, log rotation and nightly database backups built in

## 🔐 Security Features

- Password hashing with bcrypt (10 rounds)
- JWT token authentication
- Token expiration
- Protected API routes
- Request validation
- SQL injection prevention (Sequelize)
- XSS prevention
- CORS configuration
- Environment variable protection

## 📈 Future Enhancement Ideas

- Email notifications
- Book recommendations
- Reading statistics
- Import/export functionality
- Advanced search filters
- Book series tracking
- Reading goals
- Social features
- Mobile app
- Calibre integration
- E-book file management
- Reading progress tracking
- Book reviews and ratings
- Reading challenges
- Wishlist management
- Price tracking
- Multiple libraries
- Sharing and collaboration
