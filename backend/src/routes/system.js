const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const { auth, adminAuth } = require('../middleware/auth');

router.use(auth);
router.use(adminAuth);

router.get('/status', systemController.getStatus);
router.get('/logs', systemController.getLogs);

router.get('/backup/download', systemController.downloadBackup);
router.post('/backup/restore', systemController.restoreBackup);

module.exports = router;
