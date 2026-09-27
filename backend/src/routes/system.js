const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const { auth, adminAuth } = require('../middleware/auth');

// Uploads (including the backup restore) are parsed by the express-fileupload middleware that
// server.js registers globally - see the comment there. A second parser on this route would try to
// read an already consumed body and fail with "Unexpected end of form".
router.use(auth);
router.use(adminAuth);

router.get('/status', systemController.getStatus);
router.get('/logs', systemController.getLogs);

// GitHub's newest published release. Server-side so the browser never sees GitHub's 404 (only
// drafts published) and the request is not counted against the browser's anonymous rate limit.
router.get('/updates', systemController.checkForUpdates);

router.get('/backup/download', systemController.downloadBackup);
router.post('/backup/restore', systemController.restoreBackup);

module.exports = router;
