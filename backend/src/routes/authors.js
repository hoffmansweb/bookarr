const express = require('express');
const router = express.Router();
const authorController = require('../controllers/authorController');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/monitored', authorController.getMonitored);
router.get('/', authorController.getAll);
router.get('/:id', authorController.getById);
router.post('/', authorController.create);
router.put('/:id', authorController.update);
router.delete('/:id', authorController.delete);
router.post('/:id/monitor', authorController.monitor);
router.delete('/:id/monitor', authorController.unmonitor);
router.post('/:id/refresh', authorController.refreshBooks);
router.post('/:id/toggle-books', authorController.toggleAllBooks);
router.post('/:id/search-wanted', authorController.searchWanted);

module.exports = router;
