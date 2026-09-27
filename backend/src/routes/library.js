const express = require('express');
const router = express.Router();
const libraryController = require('../controllers/libraryController');
const { auth, adminAuth } = require('../middleware/auth');

router.use(auth);
router.use(adminAuth);

router.post('/scan', libraryController.scanLibrary);

module.exports = router;
