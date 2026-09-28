const express = require('express');
const router = express.Router();
const bookController = require('../controllers/bookController');
const { auth, adminAuth } = require('../middleware/auth');

// File serving handles its own auth
router.get('/:id/file', bookController.getFile);

router.use(auth);

router.get('/search', bookController.search);
router.get('/library', bookController.getLibrary);
router.get('/starred', bookController.getStarred);
router.get('/continue-reading', bookController.getContinueReading);
router.get('/continue-listening', bookController.getContinueListening);
// Dashboard "New Arrivals" (books whose file landed most recently)
router.get('/recent-arrivals', bookController.getRecentArrivals);
router.get('/amazon/bestsellers', bookController.getAmazonBestsellers);
router.get('/amazon/new-releases', bookController.getAmazonNewReleases);
// Launches a (non-headless) browser on the server for up to 5 minutes
router.get('/amazon/my-books', adminAuth, bookController.getAmazonMyBooks);
router.get('/amazon/check', bookController.checkAmazonConnection);
router.get('/', bookController.getAll);
// Tells the reader whether the file is reachable before it downloads it
router.get('/:id/file-status', bookController.getFileStatus);
router.get('/:id/progress', bookController.getDownloadProgress);
router.post('/:id/extract-chapters', bookController.extractChapters);
router.post('/:id/progress', bookController.updateProgress);
router.post('/:id/reading-progress', bookController.updateReadingProgress);
router.get('/:id', bookController.getById);
router.post('/:id/fetch-metadata', bookController.fetchMetadata);
router.post('/:id/cancel-download', bookController.cancelDownload);
router.post('/', bookController.create);
router.post('/grab', bookController.grab);
router.post('/add-series', bookController.addSeries);
router.put('/:id', bookController.update);
// Books are shared across all users; deleting one removes it for everyone
router.delete('/:id', adminAuth, bookController.delete);
router.post('/:id/library', bookController.addToLibrary);
router.post('/:id/star', bookController.toggleStar);
router.post('/:id/book-progress', bookController.updateBookProgress);

module.exports = router;
