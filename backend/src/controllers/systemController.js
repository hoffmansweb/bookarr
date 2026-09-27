const fs = require('fs');
const path = require('path');
const os = require('os');
const sequelize = require('../config/database');
const { getSetting } = require('./settingsController');

function getDiskSpace(folderPath) {
  try {
    if (!folderPath) return null;
    
    // Resolve absolute path
    const resolvedPath = path.resolve(folderPath);
    if (!fs.existsSync(resolvedPath)) {
      return {
        path: resolvedPath,
        error: 'Path does not exist',
        free: 0,
        total: 0,
        used: 0,
        percentage: 0
      };
    }

    // Node v18.9+ has statfsSync
    if (fs.statfsSync) {
      const stats = fs.statfsSync(resolvedPath);
      const free = stats.bfree * stats.bsize;
      const total = stats.blocks * stats.bsize;
      const used = total - free;
      return {
        path: resolvedPath,
        free,
        total,
        used,
        percentage: total > 0 ? Math.round((used / total) * 100) : 0
      };
    }

    return null;
  } catch (err) {
    console.error(`Disk space check failed for ${folderPath}:`, err.message);
    return {
      path: folderPath,
      error: err.message,
      free: 0,
      total: 0,
      used: 0,
      percentage: 0
    };
  }
}

exports.getStatus = async (req, res) => {
  try {
    // 1. Check Database connection
    let dbConnected = false;
    try {
      await sequelize.authenticate();
      dbConnected = true;
    } catch (e) {
      console.error('Sequelize connection failed:', e.message);
    }

    // 2. Read folder paths from settings
    const ebooksFolder = await getSetting('ebooks_folder');
    const audiobooksFolder = await getSetting('audiobooks_folder');
    const downloadFolder = await getSetting('download_folder');

    const disks = [];
    if (ebooksFolder) {
      const info = getDiskSpace(ebooksFolder);
      if (info) disks.push({ name: 'Ebooks Library', ...info });
    }
    if (audiobooksFolder) {
      const info = getDiskSpace(audiobooksFolder);
      if (info) disks.push({ name: 'Audiobooks Library', ...info });
    }
    if (downloadFolder) {
      const info = getDiskSpace(downloadFolder);
      if (info) disks.push({ name: 'Downloads Folder', ...info });
    }

    // 3. Gather OS and process stats
    const memory = process.memoryUsage();
    const systemInfo = {
      platform: process.platform,
      arch: process.arch,
      osType: os.type(),
      osRelease: os.release(),
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      dbStatus: dbConnected ? 'connected' : 'disconnected'
    };

    res.json({
      system: systemInfo,
      disks,
      processMemory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getLogs = async (req, res) => {
  try {
    const logFilePath = require('path').join(require('../config/logger').LOG_DIR, 'combined.log');
    
    if (!fs.existsSync(logFilePath)) {
      return res.json({ logs: [] });
    }

    const data = await fs.promises.readFile(logFilePath, 'utf8');
    const lines = data.split('\n').filter(line => line.trim());
    
    // Get last 200 lines
    const lastLines = lines.slice(-200).reverse(); // Reverse so latest logs are on top

    res.json({ logs: lastLines });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
