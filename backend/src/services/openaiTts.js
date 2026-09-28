// Client for any OpenAI-compatible speech endpoint (POST {base}/audio/speech):
// Kokoro-FastAPI (ghcr.io/remsky/kokoro-fastapi-*, port 8880), openedai-speech,
// LocalAI, AllTalk, or OpenAI itself.
//
// Settings: tts_openai_base_url (e.g. http://proxmox:8880/v1), tts_openai_model (default kokoro),
//           tts_openai_voice (default af_heart), tts_openai_api_key (optional; "not-needed" for Kokoro)
const axios = require('axios');
const fs = require('fs');
const { getSetting } = require('../controllers/settingsController');

const KOKORO_FALLBACK_VOICES = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam', 'am_michael', 'am_fenrir', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'];

// The configured URL can be a bare host ("http://host:8880"), a versioned base
// ("http://host:8880/v1"), or a full speech endpoint ("https://api.free.ai/v1/tts"). Normalise it
// into the two URLs the client needs: where to POST audio and where to list voices.
const getConfig = async () => {
  const raw = (await getSetting('tts_openai_base_url')) || '';
  let root = raw.trim().replace(/\/+$/, '');
  let speechUrl = '';
  let voicesUrl = '';
  if (root) {
    if (!/\/v\d+$/i.test(root) && !/\/(tts|audio\/speech)$/i.test(root)) root += '/v1';
    speechUrl = /\/(tts|audio\/speech)$/i.test(root) ? root : `${root}/audio/speech`;
    voicesUrl = `${root.replace(/\/(tts|audio\/speech)$/i, '')}/audio/voices`;
  }
  return {
    speechUrl,
    voicesUrl,
    model: (await getSetting('tts_openai_model')) || 'kokoro',
    voice: (await getSetting('tts_openai_voice')) || 'af_heart',
    apiKey: (await getSetting('tts_openai_api_key')) || 'not-needed'
  };
};

const isConfigured = async () => !!(await getConfig()).speechUrl;

/**
 * Synthesize `text` to an mp3 file.
 * @returns {Promise<string>} outPath
 */
const speak = async (text, outPath, { voice, speed = 1, model, signal } = {}) => {
  const cfg = await getConfig();
  if (!cfg.speechUrl) throw new Error('OpenAI-compatible TTS server not configured (Settings > Text-to-Speech)');

  const { data } = await axios.post(cfg.speechUrl, {
    model: model || cfg.model,
    input: text,
    voice: voice || cfg.voice,
    response_format: 'mp3',
    speed: Math.max(0.25, Math.min(4, Number(speed) || 1))
  }, {
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    responseType: 'arraybuffer',
    timeout: 180000,
    signal // aborts the request if the listener went away (reader stopped / switched voice)
  });

  if (!data || data.byteLength < 100) throw new Error('TTS server returned empty audio');
  await fs.promises.writeFile(outPath, Buffer.from(data));
  return outPath;
};

let voiceCache = { at: 0, voices: [] };

/** List voices from the server (Kokoro exposes GET /v1/audio/voices), cached 10 min. */
const voiceGrades = new Map(); // id -> Kokoro overall_grade (A, B-, C+ ...)
const gradeRank = (g) => (g ? 'ABCDEF'.indexOf(g[0]) * 3 + (g[1] === '+' ? 0 : g[1] === '-' ? 2 : 1) : 99);

/**
 * Voices the server offers right now, best-graded first. Empty while the server is
 * unreachable, so clients never see voices that can't play. Cached 10 min (1 min when down).
 */
const listVoices = async () => {
  const cfg = await getConfig();
  if (!cfg.speechUrl) return [];
  const ttl = voiceCache.voices.length ? 10 * 60 * 1000 : 60 * 1000;
  if (Date.now() - voiceCache.at < ttl && voiceCache.key === cfg.voicesUrl) return voiceCache.voices;
  try {
    const { data } = await axios.get(cfg.voicesUrl, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, timeout: 5000 });
    const raw = Array.isArray(data) ? data : data.voices || [];
    raw.forEach(v => { if (v && typeof v === 'object' && v.id) voiceGrades.set(v.id, v.overall_grade || null); });
    let voices = raw.map(v => (typeof v === 'string' ? v : v.id || v.name)).filter(Boolean);
    // Server answered but has no voice listing endpoint content: assume the stock Kokoro set
    if (!voices.length) voices = cfg.model === 'kokoro' ? KOKORO_FALLBACK_VOICES : [cfg.voice];
    voices.sort((a, b) => gradeRank(voiceGrades.get(a)) - gradeRank(voiceGrades.get(b)) || a.localeCompare(b));
    voiceCache = { at: Date.now(), key: cfg.voicesUrl, voices };
  } catch (e) {
    voiceCache = { at: Date.now(), key: cfg.voicesUrl, voices: [] };
  }
  return voiceCache.voices;
};

/** True when a server is configured and answered the last voice listing. */
const isAvailable = async () => (await listVoices()).length > 0;

/** Pick a voice the server actually has: the requested one, else the default, else the best-graded. */
const resolveVoice = async (requested) => {
  const voices = await listVoices();
  const cfg = await getConfig();
  const id = String(requested || '').replace(/^oai:/, '');
  if (id && voices.includes(id)) return id;
  if (voices.includes(cfg.voice)) return cfg.voice;
  return voices[0] || cfg.voice;
};

// Kokoro voice ids encode accent + gender: a=US, b=British, f/m=female/male
const describeVoice = (id) => {
  const m = /^([abejfhipz])([fm])_(.+)$/.exec(id);
  if (!m) return id;
  const accent = { a: 'US', b: 'UK', e: 'ES', f: 'FR', h: 'HI', i: 'IT', j: 'JP', p: 'PT', z: 'ZH' }[m[1]] || '';
  const name = m[3].split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const grade = voiceGrades.get(id);
  return `[${accent}] ${name} (${m[2] === 'f' ? 'Female' : 'Male'})${grade ? ` (Grade: ${grade})` : ''}`.trim();
};

/** Quick connectivity check for the settings page. */
const test = async () => {
  const cfg = await getConfig();
  if (!cfg.speechUrl) return { success: false, error: 'No server URL configured' };
  const os = require('os');
  const path = require('path');
  const tmp = path.join(os.tmpdir(), `bookarr-tts-test-${Date.now()}.mp3`);
  try {
    const t = Date.now();
    await speak('Bookarr text to speech test.', tmp);
    const voices = await listVoices();
    return { success: true, message: `TTS server OK (${Date.now() - t} ms, ${voices.length} voices)` };
  } catch (e) {
    return { success: false, error: e.response ? `HTTP ${e.response.status}` : e.message };
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
};

module.exports = { speak, listVoices, describeVoice, isConfigured, isAvailable, resolveVoice, getConfig, test };
