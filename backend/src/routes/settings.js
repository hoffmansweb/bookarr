const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { auth, adminAuth } = require('../middleware/auth');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

router.use(auth);
router.use(adminAuth);

router.get('/', settingsController.getAll);
router.put('/', settingsController.update);
router.get('/export', settingsController.exportSettings);
router.post('/import', settingsController.importSettings);

router.get('/drives', (req, res) => {
  try {
    const drives = [];
    if (os.platform() === 'win32') {
      try {
        const output = execSync('wmic logicaldisk get name', { encoding: 'utf8', windowsHide: true, timeout: 10000 });
        const lines = output.split('\n').filter(line => line.trim() && line.trim() !== 'Name');
        lines.forEach(line => {
          const drive = line.trim();
          if (drive) drives.push(drive);
        });
      } catch (e) {
        // wmic is deprecated/removed on recent Windows builds; probe drive letters instead
        for (let c = 65; c <= 90; c++) {
          const drive = `${String.fromCharCode(c)}:`;
          try { if (fs.existsSync(`${drive}\\`)) drives.push(drive); } catch (err) { /* ignore */ }
        }
      }
    } else {
      // Docker volume mounts first, then real filesystems
      for (const p of ['/library', '/downloads', '/']) if (fs.existsSync(p)) drives.push(p);
      try {
        const output = execSync('df -h | grep "^/dev"', { encoding: 'utf8', timeout: 10000 });
        output.split('\n').filter(line => line.trim()).forEach(line => {
          const parts = line.split(/\s+/);
          if (parts[5]) drives.push(parts[5]);
        });
      } catch (e) { /* df unavailable */ }
    }
    res.json({ drives: [...new Set(drives)] });
  } catch (error) {
    res.json({ drives: [] });
  }
});

router.get('/folders', (req, res) => {
  try {
    const { path: dirPath } = req.query;
    if (!dirPath || typeof dirPath !== 'string') return res.status(400).json({ error: 'Path required' });
    if (dirPath.includes('\0')) return res.status(400).json({ error: 'Invalid path' });

    // Admin-only folder picker. Require an absolute path and normalise it so
    // relative segments ("..") can't be used to walk from the server's cwd.
    let target = dirPath;
    if (/^[A-Za-z]:$/.test(target)) target += path.sep; // "C:" means cwd-on-drive; use the drive root
    if (!path.isAbsolute(target)) return res.status(400).json({ error: 'Absolute path required' });
    target = path.resolve(target);

    const items = fs.readdirSync(target, { withFileTypes: true });
    const folders = items
      .filter(item => item.isDirectory())
      .map(item => path.join(target, item.name));
    
    res.json({ folders });
  } catch (error) {
    res.json({ folders: [] });
  }
});

module.exports = router;
