const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, '..', '..', 'tts', 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const VOICES = [
  { id: 'en-US-AriaNeural', label: '🇺🇸 Aria (Female)' },
  { id: 'en-US-JennyNeural', label: '🇺🇸 Jenny (Female)' },
  { id: 'en-US-MichelleNeural', label: '🇺🇸 Michelle (Female)' },
  { id: 'en-US-AvaNeural', label: '🇺🇸 Ava (Female)' },
  { id: 'en-US-EmmaNeural', label: '🇺🇸 Emma (Female)' },
  { id: 'en-US-GuyNeural', label: '🇺🇸 Guy (Male)' },
  { id: 'en-US-ChristopherNeural', label: '🇺🇸 Christopher (Male)' },
  { id: 'en-US-EricNeural', label: '🇺🇸 Eric (Male)' },
  { id: 'en-US-BrianNeural', label: '🇺🇸 Brian (Male)' },
  { id: 'en-US-RogerNeural', label: '🇺🇸 Roger (Male)' },
  { id: 'en-US-SteffanNeural', label: '🇺🇸 Steffan (Male)' },
  { id: 'en-US-AndrewNeural', label: '🇺🇸 Andrew (Male)' },
  { id: 'en-US-AnaNeural', label: '🇺🇸 Ana (Female, Young)' },
  { id: 'en-GB-SoniaNeural', label: '🇬🇧 Sonia (Female)' },
  { id: 'en-GB-RyanNeural', label: '🇬🇧 Ryan (Male)' },
  { id: 'en-GB-LibbyNeural', label: '🇬🇧 Libby (Female)' },
  { id: 'en-GB-ThomasNeural', label: '🇬🇧 Thomas (Male)' },
  { id: 'en-AU-NatashaNeural', label: '🇦🇺 Natasha (Female)' },
  { id: 'en-AU-WilliamMultilingualNeural', label: '🇦🇺 William (Male)' },
];

// Voices from a local OpenAI-compatible server (e.g. Kokoro) are listed first with an "oai:" prefix
const LOCAL_PREFIX = 'oai:';

async function getAvailableVoices() {
  try {
    // Empty while the server is down, so users only see voices that can play
    const openaiTts = require('./openaiTts');
    const externalTts = require('./externalTts');
    const local = (await openaiTts.listVoices()).map(v => ({ id: LOCAL_PREFIX + v, label: `🏠 Kokoro: ${openaiTts.describeVoice(v)}`, local: true }));
    // External (non-OpenAI) TTS: a single voice entry configured in Settings, prefixed "ext:"
    const extCfg = await externalTts.getConfig();
    const external = extCfg.baseUrl
      ? [{ id: `ext:${extCfg.voice}`, label: `🌐 External (${extCfg.model}): ${extCfg.voice}`, local: false }]
      : [];
    return [...local, ...external, ...VOICES];
  } catch (e) {
    return VOICES;
  }
}

const EDGE_SCRIPT = path.join(__dirname, '..', '..', 'tts', 'edge_tts_speak.py');

async function synthesize(text, voiceId = 'en-US-AriaNeural', speed = 1, { signal } = {}) {
  const hash = crypto.createHash('md5').update(`${voiceId}-${speed}-${text}`).digest('hex');
  const mp3File = path.join(CACHE_DIR, `${hash}.mp3`);
  if (fs.existsSync(mp3File) && fs.statSync(mp3File).size > 0) return mp3File;

  if (String(voiceId).startsWith(LOCAL_PREFIX)) {
    const openaiTts = require('./openaiTts');
    try {
      return await openaiTts.speak(text, mp3File, { voice: voiceId.slice(LOCAL_PREFIX.length), speed, signal });
    } catch (e) {
      // Keep reading aloud with an Edge voice if the local server is down
      // (separate call so the Edge audio is cached under its own key, not the Kokoro voice's)
      if (signal?.aborted) throw e; // listener gone: don't bother with the Edge fallback
      console.warn(`Local TTS failed (${e.message}); falling back to Edge TTS`);
      return synthesize(text, 'en-US-AriaNeural', speed);
    }
  }

  // External (non-OpenAI) TTS, e.g. https://api.free.ai/v1/tts
  if (String(voiceId).startsWith('ext:')) {
    const externalTts = require('./externalTts');
    try {
      return await externalTts.speak(text, mp3File, { voice: voiceId.slice('ext:'.length), signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn(`External TTS failed (${e.message}); falling back to Edge TTS`);
      return synthesize(text, 'en-US-AriaNeural', speed);
    }
  }

  // Validate voice is an Edge TTS voice
  if (!VOICES.find(v => v.id === voiceId)) voiceId = 'en-US-AriaNeural';

  const rawRate = Math.round((speed - 1) * 100);
  const clampedRate = Math.max(-50, Math.min(100, rawRate));
  const rate = `${clampedRate >= 0 ? '+' : ''}${clampedRate}%`;

  return new Promise((resolve, reject) => {
    const { pythonPath } = require('../utils/binaries');
    const proc = execFile(pythonPath, [EDGE_SCRIPT, voiceId, rate, mp3File], { timeout: 30000 }, (err) => {
      if (err) return reject(err);
      if (fs.existsSync(mp3File)) resolve(mp3File);
      else reject(new Error('No output generated'));
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

// Clean cache older than 1 hour
setInterval(() => {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(CACHE_DIR)) {
      const fp = path.join(CACHE_DIR, f);
      if (now - fs.statSync(fp).mtimeMs > 3600000) fs.unlinkSync(fp);
    }
  } catch (e) {}
}, 1800000);

module.exports = { getAvailableVoices, synthesize };
