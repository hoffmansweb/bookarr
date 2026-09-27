const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/queue', activityController.getQueue);
router.get('/history', activityController.getHistory);
router.delete('/queue/:id', activityController.cancelQueueItem);

module.exports = router;
