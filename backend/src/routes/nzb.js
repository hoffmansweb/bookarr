const express = require('express');
const router = express.Router();
const nzbController = require('../controllers/nzbController');
const { auth, adminAuth } = require('../middleware/auth');

router.use(auth);

router.get('/search', nzbController.searchBook);
router.get('/status', nzbController.getStatus);
router.get('/youtube/search', nzbController.youtubeSearch);
router.post('/youtube/download', adminAuth, nzbController.youtubeDownload);
router.get('/audiobook/search', nzbController.audiobookSearch);
router.post('/audiobook/download', adminAuth, nzbController.audiobookDownload);
router.post('/audiobook/auto', adminAuth, nzbController.audiobookAuto);
router.post('/download', adminAuth, nzbController.download);
router.get('/source-order', nzbController.getSourceOrder);

module.exports = router;
