const express = require('express');
const router = express.Router();
const jobsController = require('../controllers/jobsController');
const { auth, adminAuth } = require('../middleware/auth');

// Jobs hit every indexer/scraper and move files; only admins may trigger them
router.use(auth);
router.use(adminAuth);

router.get('/', jobsController.list);
router.post('/:id/run', jobsController.run);
router.post('/monitoring', jobsController.runMonitoring);
router.post('/search', jobsController.runSearch);
router.post('/download-check', jobsController.runDownloadCheck);
router.post('/library-sync', jobsController.runLibrarySync);
router.post('/books-refresh', jobsController.runBooksRefresh);

module.exports = router;
