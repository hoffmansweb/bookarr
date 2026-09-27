# Bookarr - System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                             │
│                     http://localhost:3000                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP/WebSocket
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                      REACT FRONTEND                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Pages: Dashboard, Books, Authors, Library, Auth         │  │
│  │  Components: Navbar, BookCard, AuthorCard, SearchBar     │  │
│  │  Context: AuthContext, SocketContext                     │  │
│  │  Services: API Client (Axios)                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ REST API + Socket.io
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    EXPRESS BACKEND API                           │
│                   http://localhost:5000                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Routes: /auth, /books, /authors, /notifications         │  │
│  │  Controllers: Handle requests & responses                │  │
│  │  Middleware: JWT Auth, Validation, Error Handling        │  │
│  │  Socket.io: Real-time notifications                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────┬──────────────────┬──────────────────┬────────────────┬───┘
      │                  │                  │                │
      │                  │                  │                │
┌─────▼─────┐  ┌─────────▼────────┐  ┌─────▼──────┐  ┌────▼─────┐
│ Database  │  │  External APIs   │  │  Scrapers  │  │   Jobs   │
│           │  │                  │  │            │  │          │
│ SQLite    │  │ • Google Books   │  │ • Goodreads│  │ Monitor  │
│           │  │ • Open Library   │  │            │  │  (Cron)  │
│ • Users   │  │                  │  │            │  │          │
│ • Books   │  │                  │  │            │  │ Every 6h │
│ • Authors │  │                  │  │            │  │          │
│ • Notifs  │  │                  │  │            │  │          │
└───────────┘  └──────────────────┘  └────────────┘  └──────────┘
```

## Data Flow Diagrams

### 1. User Authentication Flow

```
User → Login Page → POST /api/auth/login → Verify Credentials
                                          ↓
                                    Generate JWT Token
                                          ↓
                                    Return Token + User
                                          ↓
                              Store Token in localStorage
                                          ↓
                              Include in all API requests
                                          ↓
                              Backend validates JWT
                                          ↓
                              Allow/Deny access
```

### 2. Book Search Flow

```
User enters search query
        ↓
Frontend → GET /api/books/search?query=...
        ↓
Backend Aggregator Service
        ↓
    ┌───┴───┬───────────┬──────────┐
    ↓       ↓           ↓          ↓
Google   Open      Goodreads   (parallel)
Books    Library   Scraper
    ↓       ↓           ↓          ↓
    └───┬───┴───────────┴──────────┘
        ↓
Deduplicate & Merge Results
        ↓
Return Combined Results
        ↓
Display in UI (BookCard components)
```

### 3. Author Monitoring Flow

```
User clicks "Monitor" on Author
        ↓
POST /api/authors/:id/monitor
        ↓
Update Author.monitored = true
        ↓
Add to UserAuthors junction table
        ↓
        
[Every 6 hours - Cron Job]
        ↓
Fetch all monitored authors
        ↓
For each author:
    ↓
    Search for books (all sources)
    ↓
    Compare with existing books (by ISBN)
    ↓
    New books found?
    ↓
    YES → Enrich book data
        ↓
        Create Book record
        ↓
        Create Notifications for followers
        ↓
        Emit Socket.io event
        ↓
        Frontend receives notification
        ↓
        Update notification badge
```

### 4. Real-Time Notification Flow

```
Backend Event (new book detected)
        ↓
Create Notification in DB
        ↓
io.emit('notification', data)
        ↓
Socket.io broadcasts to connected clients
        ↓
Frontend Socket listener receives event
        ↓
Update notifications state
        ↓
Show notification badge
        ↓
Display in dropdown
        ↓
User clicks notification
        ↓
Navigate to book/author
```

## Component Hierarchy

### Frontend Component Tree

```
App
├── Router
    ├── Login (public)
    ├── Register (public)
    └── PrivateRoute (protected)
        ├── Navbar
        │   ├── Navigation Links
        │   ├── Notifications Dropdown
        │   └── User Menu
        └── Routes
            ├── Dashboard
            │   ├── Stats Cards
            │   └── Recent Books (BookCard[])
            ├── Books
            │   ├── SearchBar
            │   ├── Filters
            │   └── BookCard[]
            ├── Authors
            │   ├── SearchBar
            │   ├── Filters
            │   └── AuthorCard[]
            └── Library
                └── BookCard[]
```

## Database Schema

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│    Users    │         │  UserBooks   │         │    Books    │
├─────────────┤         ├──────────────┤         ├─────────────┤
│ id (PK)     │────┐    │ userId (FK)  │    ┌────│ id (PK)     │
│ username    │    │    │ bookId (FK)  │    │    │ title       │
│ email       │    │    └──────────────┘    │    │ isbn13      │
│ password    │    │                        │    │ authorId(FK)│
│ role        │    │    ┌──────────────┐    │    │ status      │
└─────────────┘    │    │ UserAuthors  │    │    │ monitored   │
                   └────├──────────────┤    │    │ coverUrl    │
                        │ userId (FK)  │    │    │ rating      │
                   ┌────│ authorId(FK) │    │    └─────────────┘
                   │    └──────────────┘    │            │
                   │                        │            │
┌─────────────┐   │                        │            │
│   Authors   │───┘                        │            │
├─────────────┤                            │            │
│ id (PK)     │────────────────────────────┘            │
│ name        │                                         │
│ bio         │                                         │
│ monitored   │                                         │
│ lastChecked │                                         │
└─────────────┘                                         │
                                                        │
┌──────────────┐                                       │
│Notifications │                                       │
├──────────────┤                                       │
│ id (PK)      │                                       │
│ userId (FK)  │───────────────────────────────────────┘
│ type         │
│ title        │
│ message      │
│ read         │
└──────────────┘
```

## API Request/Response Flow

### Example: Create Book

```
1. Frontend Request:
   POST /api/books
   Headers: { Authorization: "Bearer <token>" }
   Body: {
     title: "Book Title",
     authorId: "uuid",
     isbn13: "1234567890123",
     status: "wanted"
   }

2. Backend Processing:
   ↓
   Auth Middleware validates JWT
   ↓
   Extract user from token
   ↓
   Controller receives request
   ↓
   Validate request body
   ↓
   Check if book has googleBooksId
   ↓
   YES → Enrich data from APIs
   ↓
   Create book in database
   ↓
   Return book object

3. Frontend Response:
   Status: 201 Created
   Body: {
     id: "uuid",
     title: "Book Title",
     author: { name: "Author Name" },
     coverUrl: "https://...",
     rating: 4.5,
     ...
   }
   ↓
   Update UI
   ↓
   Show success toast
```

## Service Integration Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Book Aggregator Service                     │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  searchAllSources(query)                       │    │
│  │    ├─→ Google Books API                        │    │
│  │    ├─→ Open Library API                        │    │
│  │    └─→ Goodreads Scraper                       │    │
│  │                                                 │    │
│  │  enrichBookData(book)                          │    │
│  │    ├─→ Fetch by ISBN from Google Books        │    │
│  │    ├─→ Fetch by ISBN from Open Library        │    │
│  │    ├─→ Fetch by ID from Goodreads             │    │
│  │    └─→ Merge all data sources                 │    │
│  │                                                 │    │
│  │  deduplicateBooks(books)                       │    │
│  │    ├─→ Match by ISBN                           │    │
│  │    ├─→ Fallback to title matching             │    │
│  │    └─→ Merge duplicate entries                │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Monitoring Job Architecture

```
┌──────────────────────────────────────────────────────┐
│           Monitoring Job (Cron Schedule)              │
│                                                       │
│  Trigger: Every 6 hours (0 */6 * * *)               │
│                                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │ 1. Fetch all monitored authors              │    │
│  │    WHERE monitored = true                   │    │
│  └─────────────────┬───────────────────────────┘    │
│                    │                                 │
│  ┌─────────────────▼───────────────────────────┐    │
│  │ 2. For each author:                         │    │
│  │    ├─→ Search books (all sources)           │    │
│  │    ├─→ Get existing books from DB           │    │
│  │    ├─→ Compare ISBNs                        │    │
│  │    └─→ Identify new books                   │    │
│  └─────────────────┬───────────────────────────┘    │
│                    │                                 │
│  ┌─────────────────▼───────────────────────────┐    │
│  │ 3. For each new book:                       │    │
│  │    ├─→ Enrich data from APIs                │    │
│  │    ├─→ Create Book record                   │    │
│  │    ├─→ Get author's followers               │    │
│  │    └─→ Create notifications                 │    │
│  └─────────────────┬───────────────────────────┘    │
│                    │                                 │
│  ┌─────────────────▼───────────────────────────┐    │
│  │ 4. Update author.lastChecked                │    │
│  │    Emit Socket.io events                    │    │
│  │    Log results                              │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

## Security Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Security Layers                     │
│                                                      │
│  1. Frontend                                        │
│     ├─→ Token stored in localStorage               │
│     ├─→ PrivateRoute component                     │
│     └─→ Automatic redirect on 401                  │
│                                                      │
│  2. API Gateway                                     │
│     ├─→ CORS configuration                         │
│     ├─→ Rate limiting (ready)                      │
│     └─→ Request validation                         │
│                                                      │
│  3. Authentication Middleware                       │
│     ├─→ Extract JWT from header                    │
│     ├─→ Verify token signature                     │
│     ├─→ Check expiration                           │
│     └─→ Load user from database                    │
│                                                      │
│  4. Authorization                                   │
│     ├─→ Check user role                            │
│     ├─→ Verify resource ownership                  │
│     └─→ Admin-only routes                          │
│                                                      │
│  5. Database                                        │
│     ├─→ Password hashing (bcrypt)                  │
│     ├─→ Prepared statements (Sequelize)            │
│     └─→ Input sanitization                         │
└─────────────────────────────────────────────────────┘
```

## Deployment Architecture (Docker)

```
┌─────────────────────────────────────────────────────┐
│             Docker Compose network                  │
│                                                     │
  ┌───────────────────────────────────────────────────┐
  │ bookarr            one image: API + built React UI│
  │ Port: 5000         ->  web UI and API             │
  │ SQLite: /app/data/database.sqlite                 │
  │ Volumes: /app/data /downloads /library            │
  └───────────────────────────────────────────────────┘
│                                                     │
│ flaresolverr :8191       searxng :8080              │
│                                                     │
  ┌───────────────────────────────────────────────────┐
  │ host machine                                      │
  │                                                   │
  │ localhost:5000          ->  web UI + API          │
  │ ./downloads ./library   ->  mounted folders       │
  └───────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────┘
```

## Technology Stack Diagram

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND STACK                     │
├─────────────────────────────────────────────────────┤
│  React 19                                           │
│  React Router DOM                                   │
│  Axios                                              │
│  Socket.io Client                                   │
│  React Query                                        │
│  React Toastify                                     │
│  CSS3                                               │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                   BACKEND STACK                      │
├─────────────────────────────────────────────────────┤
│  Node.js                                            │
│  Express.js                                         │
│  Sequelize ORM                                      │
│  SQLite                                             │
│  JWT (jsonwebtoken)                                 │
│  Bcrypt                                             │
│  Socket.io                                          │
│  Node-cron                                          │
│  Winston (logging)                                  │
│  Axios                                              │
│  Cheerio (scraping)                                 │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                EXTERNAL SERVICES                     │
├─────────────────────────────────────────────────────┤
│  Google Books API                                   │
│  Open Library API                                   │
│  Goodreads (web scraping)                           │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                   DEVOPS STACK                       │
├─────────────────────────────────────────────────────┤
│  Docker                                             │
│  Docker Compose                                     │
│  Git                                                │
└─────────────────────────────────────────────────────┘
```

This architecture provides:
- ✅ Scalability (microservices-ready)
- ✅ Maintainability (clear separation of concerns)
- ✅ Security (multiple layers)
- ✅ Real-time capabilities (Socket.io)
- ✅ Data redundancy (multiple sources)
- ✅ Automated workflows (cron jobs)
- ✅ Easy deployment (Docker)
