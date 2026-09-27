const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendarController');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', calendarController.getCalendarEvents);

module.exports = router;
