const express = require('express');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const path = require('path');
const http = require('http');
const os = require('os');
const socketIo = require('socket.io');
require('dotenv').config();
require('./config/secrets').ensureJwtSecret();

const sequelize = require('./config/database');
const logger = require('./config/logger');
const { setIO: setBooksRefreshIO } = require('./jobs/booksRefresh');
const { setIO: setLibrarySyncIO } = require('./jobs/librarySync');
const initializeDatabase = require('./config/initDb');

const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');
const authorRoutes = require('./routes/authors');
const authorSearchRoutes = require('./routes/authorSearch');
const notificationRoutes = require('./routes/notifications');
const downloadClientRoutes = require('./routes/downloadClients');
const indexerRoutes = require('./routes/indexers');
const nzbRoutes = require('./routes/nzb');
const settingsRoutes = require('./routes/settings');
const bulkRoutes = require('./routes/bulk');
const jobsRoutes = require('./routes/jobs');
const libraryRoutes = require('./routes/library');
const adminRoutes = require('./routes/admin');
const ttsRoutes = require('./routes/tts');
const activityRoutes = require('./routes/activity');
const calendarRoutes = require('./routes/calendar');
const systemRoutes = require('./routes/system');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }
});

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: { title: 'Bookarr API', version: '1.0.0', description: 'Bookarr REST API for third-party integrations. You must include the API key using either the X-Api-Key header or an ?apikey= query parameter.' },
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' }
      }
    },
    security: [{ ApiKeyAuth: [] }]
  },
  apis: ['./src/routes/*.js']
};
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Uploads (cover images, .nzb files, a restored backup) are read into a temporary file instead of
// RAM, and the options are set for the biggest of them:
//   - limits.fileSize + abortOnLimit: a file over the cap is refused with HTTP 413 and a sentence.
//     The default keeps the truncated file, which then fails later as a confusing "not a database".
//   - uploadTimeout is the idle time between chunks: 5 minutes, so a large backup over WiFi is not
//     cut off and silently turned into "no file uploaded".
//   - safeFileNames stays off: the controllers read the real name (.zip vs .sqlite) and .env files.
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: os.tmpdir(),
  uploadTimeout: 5 * 60 * 1000,
  abortOnLimit: true,
  limits: { fileSize: 8 * 1024 * 1024 * 1024 },
  responseOnLimit: 'That file is larger than the 8 GB a single upload accepts',
  safeFileNames: false,
  uriDecodeFileNames: true
}));

app.use('/api/auth', authRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/authors', authorRoutes);
app.use('/api/author-search', authorSearchRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/download-clients', downloadClientRoutes);
app.use('/api/indexers', indexerRoutes);
app.use('/api/nzb', nzbRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/bulk', bulkRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/stats', require('./routes/stats'));
app.use('/api/opds', require('./routes/opds'));

app.get('/api/health', (req, res) => {
  const version = process.env.BOOKARR_VERSION || require('../package.json').version || '1.0.0';
  res.json({ status: 'ok', version, timestamp: new Date() });
});

// Serve the web app: backend/public in Docker, otherwise the local frontend build
// (so http://localhost:5000 works too, not only the separate :3000 frontend server)
const fsSync = require('fs');
const publicPath = [path.join(__dirname, '..', 'public'), path.join(__dirname, '..', '..', 'frontend', 'build')]
  .find(p => fsSync.existsSync(path.join(p, 'index.html')));
if (publicPath) app.use(express.static(publicPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
  if (!publicPath) {
    return res.status(404).type('text').send('Bookarr web app not built. Run "npm run build" in the frontend folder, or open the frontend server (port 3000).');
  }
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.use((err, req, res, next) => {
  logger.error(err);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Only authenticated clients may receive real-time events
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    socket.user = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    next(new Error('Unauthorized'));
  }
});

// Puppeteer raises some protocol failures inside its own frame setup where no scraper can
// catch them. They mean a headless browser is wedged: replace it and log one summary line
// instead of a stack trace per failed command.
const PUPPETEER_PROTOCOL_ERR = /timed out\. Increase the 'protocolTimeout'|Target closed|Session closed|Protocol error \(|Navigating frame was detached|Connection closed/i;
let protocolErrors = { count: 0, since: 0 };
process.on('unhandledRejection', (reason) => {
  const message = reason?.message || String(reason);
  if (PUPPETEER_PROTOCOL_ERR.test(message)) {
    require('./scrapers/browserPool').onProtocolFailure(message.split('.')[0]);
    protocolErrors.count++;
    if (Date.now() - protocolErrors.since > 60000) {
      logger.warn(`Headless browser stopped responding (${protocolErrors.count} protocol error${protocolErrors.count === 1 ? '' : 's'}: ${message.split('.')[0]}); restarting it`);
      protocolErrors = { count: 0, since: Date.now() };
    }
    return;
  }
  logger.error('Unhandled promise rejection:', reason);
});

io.on('connection', (socket) => {
  logger.info('Client connected');
  
  socket.on('disconnect', () => {
    logger.info('Client disconnected');
  });
});

app.set('io', io);
setBooksRefreshIO(io);
setLibrarySyncIO(io);
require('./services/libraryImport').setIO(io);
require('./jobs/scheduler').setIO(io);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connected');

    // Create any missing tables first. Plain sync() only creates tables that are absent
    // (it never alters existing ones), so existing databases are untouched. This must run
    // before the migrations below, which ALTER existing tables: on a fresh install the
    // database is empty and they would otherwise fail with "no such table: Users".
    await sequelize.sync();
    logger.info('Database synced');

    await initializeDatabase();

    // Run TTS settings migration
    const addTTSSettings = require('./migrations/addTTSSettings');
    await addTTSSettings();

    // Run mediaType migration
    const addMediaType = require('./migrations/addMediaType');
    await addMediaType();

    await require('./migrations/addSeriesColumns')();
    await require('./migrations/addLastSearchedAt')();
    // Arrival timestamps for the Dashboard's "New Arrivals" row, plus a one-time estimate for
    // files that were imported before the column existed
    await require('./migrations/addImportedAt')();
    await require('./migrations/cleanAuthorImages')();
    await require('./migrations/cleanIsbns')();

    // Repair legacy per-column UNIQUE constraints on UserBooks, which made saving progress
    // for a second book fail with SQLITE_CONSTRAINT (reader 500s every 10 seconds)
    await require('./migrations/fixUserBooksUniqueConstraints')();

    // Sync UserBooks table (without force to preserve data). Do NOT use { alter: true } for this
    // table: Sequelize's SQLite alter reads the composite primary key's autoindex, decides each
    // key column is individually UNIQUE, and rebuilds the table that way - which caps every user
    // at one book. With several books it now fails outright (UNIQUE constraint failed:
    // UserBooks_backup.UserId) and the catch below would process.exit(1) instead of booting.
    // The migration above repairs the table; plain sync() only creates it when it is missing.
    const UserBooks = require('./models/UserBooks');
    await UserBooks.sync();
    try {
      await sequelize.query("ALTER TABLE UserBooks ADD COLUMN status VARCHAR(255) DEFAULT 'unread'");
    } catch (e) {}
    try {
      await sequelize.query("ALTER TABLE Books ADD COLUMN ttsQueued BOOLEAN DEFAULT 0");
    } catch (e) {}
    logger.info('UserBooks table synced');

    // Test SOCKS proxy if configured
    if (process.env.SOCKS_PROXY) {
      logger.info('Testing SOCKS5 proxy connection...');
      try {
        const axios = require('axios');
        const { SocksProxyAgent } = require('socks-proxy-agent');
        const agent = new SocksProxyAgent(process.env.SOCKS_PROXY);
        await axios.get('https://api.ipify.org?format=json', {
          httpsAgent: agent,
          httpAgent: agent,
          timeout: 10000
        });
        logger.info('✓ SOCKS5 proxy connected successfully');
      } catch (error) {
        logger.error('✗ SOCKS5 proxy test failed:', error.message);
        logger.warn('Anna\'s Archive and LibGen will not be available');
      }
    }

    // Claim the port before starting jobs, so a second copy exits cleanly instead of also
    // running every scheduled job alongside the first one
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(PORT, '0.0.0.0', () => {
        server.off('error', reject);
        logger.info(`Server running on port ${PORT}`);
        resolve();
      });
    }).catch((err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use — Bookarr (or something else) is already running. Stop the other copy first, or set PORT in backend/.env.`);
        process.exit(1);
      }
      throw err;
    });

    // All recurring jobs (staggered schedules, run history, no overlapping runs)
    await require('./jobs').startJobs();
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
