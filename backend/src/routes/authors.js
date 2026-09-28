const express = require('express');
const router = express.Router();
const authorController = require('../controllers/authorController');
const { auth, adminAuth } = require('../middleware/auth');

router.use(auth);

router.get('/monitored', authorController.getMonitored);
router.get('/', authorController.getAll);
router.get('/:id', authorController.getById);
router.post('/', adminAuth, authorController.create);
router.put('/:id', adminAuth, authorController.update);
router.delete('/:id', adminAuth, authorController.delete);
router.post('/:id/monitor', authorController.monitor);
router.delete('/:id/monitor', authorController.unmonitor);
router.post('/:id/refresh', adminAuth, authorController.refreshBooks);
router.post('/:id/toggle-books', adminAuth, authorController.toggleAllBooks);
router.post('/:id/search-wanted', adminAuth, authorController.searchWanted);

module.exports = router;
