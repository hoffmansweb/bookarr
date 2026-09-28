// Client for "external" TTS APIs that are NOT OpenAI-compatible — e.g. https://api.free.ai/v1/tts.
// Their contract differs from the OpenAI speech endpoint:
//   request  -> POST { model, text, voice }   (note: `text`, not `input`)
//   response -> JSON { audio_url, ... }        (a URL to the generated audio, not the audio bytes)
// The audio is downloaded and transcoded to MP3 so the rest of the pipeline (chunk files,
// audio/mpeg responses, M4B merge) is unchanged.
const axios = require('axios');
const fs = require('fs');
const util = require('util');
const { execFile } = require('child_process');
const execFileAsync = util.promisify(execFile);
const { getSetting } = require('../controllers/settingsController');
const { ffmpegPath } = require('../utils/binaries');

const getConfig = async () => {
  const baseUrl = ((await getSetting('tts_external_base_url')) || '').trim().replace(/\/+$/, '');
  return {
    baseUrl,
    model: (await getSetting('tts_external_model')) || 'kokoro',
    voice: (await getSetting('tts_external_voice')) || 'af_heart',
    apiKey: (await getSetting('tts_external_api_key')) || ''
  };
};

const isConfigured = async () => !!(await getConfig()).baseUrl;

const speak = async (text, outPath, { voice, model, signal } = {}) => {
  const cfg = await getConfig();
  if (!cfg.baseUrl) throw new Error('External TTS server not configured');

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const { data } = await axios.post(cfg.baseUrl, {
    model: model || cfg.model,
    text,
    voice: voice || cfg.voice
  }, { headers, timeout: 180000, signal });

  const audioUrl = data?.audio_url || data?.url;
  if (!audioUrl) throw new Error('External TTS returned no audio URL');

  const audio = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 180000, signal });

  // Download as a raw file, then normalise to MP3 (these APIs typically hand back WAV)
  const raw = `${outPath}.raw`;
  await fs.promises.writeFile(raw, Buffer.from(audio.data));
  await execFileAsync(ffmpegPath, ['-y', '-i', raw, '-codec:a', 'libmp3lame', '-b:a', '128k', outPath], { timeout: 60000 });
  await fs.promises.unlink(raw).catch(() => {});
  return outPath;
};

module.exports = { speak, getConfig, isConfigured };
