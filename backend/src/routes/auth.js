const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');

// Rules for the register form. Every rule carries a withMessage(): express-validator's default
// "Invalid value" tells a user nothing, and the frontend shows these strings verbatim.
// frontend/src/pages/Register.js checks the same limits before the request is even sent.
const registerRules = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3 }).withMessage('Username must be at least 3 characters')
    .isLength({ max: 64 }).withMessage('Username must be 64 characters or fewer'),
  // require_tld: false — a self-hosted install often uses an address like admin@bookarr or
  // admin@localhost, which the default (TLD required) rejects. Bookarr never sends mail, so the
  // address only has to be unique and unambiguous.
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail({ require_tld: false }).withMessage('Enter a valid email address, e.g. you@example.com')
    .normalizeEmail(),
  body('password')
    .isString().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];

router.post('/register', registerRules, authController.register);

router.post('/login', authController.login);
router.get('/profile', auth, authController.getProfile);
router.put('/tts-settings', auth, authController.updateTTSSettings);
router.post('/change-password', auth, authController.changePassword);

module.exports = router;
