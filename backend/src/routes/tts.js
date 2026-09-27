const express = require('express');
const router = express.Router();
const { getAvailableVoices, synthesize } = require('../services/tts');
const ttsController = require('../controllers/ttsController');
const { auth, adminAuth } = require('../middleware/auth');

// Reader voices (array of {id,label}); with ?provider= returns {voices:[{id,name}]} for the settings page
router.get('/voices', auth, async (req, res) => {
  try {
    if (req.query.provider) return ttsController.getVoices(req, res);
    const voices = await getAvailableVoices();
    res.json(voices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/speak', auth, async (req, res) => {
  try {
    const { text, voice, speed } = req.body;
    if (!text || text.trim().length === 0) return res.status(400).json({ error: 'No text' });
    // Stop waiting on the TTS server if the reader cancels (stop / voice change / next chunk superseded)
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const mp3Path = await synthesize(text.slice(0, 10000), voice || 'en-US-AriaNeural', speed || 1, { signal: controller.signal });
    if (controller.signal.aborted) return;
    res.type('audio/mpeg').sendFile(mp3Path);
  } catch (err) {
    if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return; // listener cancelled
    const logger = require('../config/logger');
    const detail = String(err.stderr || err.message || '');
    // Common causes, in words the reader can show
    const message = /No module named ['"]?edge_tts/i.test(detail)
      ? 'The local TTS server is unreachable and the Edge TTS fallback is not installed (pip install edge-tts)'
      : /ENOENT|not recognized|python/i.test(detail) && /spawn/i.test(detail)
        ? 'Python is not available for Edge TTS'
        : /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timed out/i.test(detail)
          ? 'Text-to-speech server did not respond'
          : 'Text-to-speech failed';
    logger.error(`TTS speak failed (voice ${req.body?.voice || 'default'}): ${detail.split('\n').slice(-3).join(' ').slice(0, 400)}`);
    res.status(500).json({ error: message });
  }
});

// Get word timings for position tracking
router.post('/timings', auth, async (req, res) => {
  try {
    const { text, voice, speed } = req.body;
    if (!text) return res.json([]);
    const mp3Path = await synthesize(text.slice(0, 10000), voice || 'en-US-AriaNeural', speed || 1);
    const fs = require('fs');
    const jsonPath = mp3Path + '.json';
    if (fs.existsSync(jsonPath)) {
      res.json(JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/test-local', auth, ttsController.testLocalServer);
router.post('/convert/:bookId', auth, adminAuth, ttsController.convertToAudiobook);
router.get('/convert/:bookId', auth, ttsController.getConversionStatus);

module.exports = router;
