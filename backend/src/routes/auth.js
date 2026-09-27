const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');

router.post('/register', [
  body('username').trim().isLength({ min: 3 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], authController.register);

router.post('/login', authController.login);
router.get('/profile', auth, authController.getProfile);
router.put('/tts-settings', auth, authController.updateTTSSettings);
router.post('/change-password', auth, authController.changePassword);

module.exports = router;
