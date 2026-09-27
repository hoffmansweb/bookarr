import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { ttsAPI, authAPI } from '../../../services/api';
import { Card, Field, TextInput, Select, Grid } from '../ui';

const PROVIDERS = [
  { value: 'openai-compatible', label: 'Local / OpenAI-compatible (Kokoro)' },
  { value: 'google', label: 'Google Cloud TTS' },
  { value: 'openai', label: 'OpenAI TTS' },
  { value: 'elevenlabs', label: 'ElevenLabs' }
];

const TtsSection = ({ settings, set, saveNow }) => {
  const [tts, setTts] = useState({ provider: 'openai-compatible', voiceName: '', speed: 1.0, languageCode: 'en-US' });
  const [voices, setVoices] = useState([]);

  const loadVoices = (provider) => ttsAPI.getVoices(provider).then(({ data }) => setVoices(data.voices || [])).catch(() => setVoices([]));

  useEffect(() => {
    authAPI.getProfile().then(({ data }) => {
      if (data.user?.ttsSettings) {
        setTts(data.user.ttsSettings);
        loadVoices(data.user.ttsSettings.provider);
      } else {
        loadVoices('openai-compatible');
      }
    }).catch(() => {});
  }, []);

  const saveTts = async () => {
    try {
      await ttsAPI.updateSettings(tts);
      toast.success('Narration defaults saved');
    } catch (e) {
      toast.error('Failed to save narration defaults');
    }
  };

  const testServer = async () => {
    try {
      await saveNow(); // test what's on screen
      const { data } = await ttsAPI.testLocal();
      if (data.success) toast.success(data.message);
      else toast.error(data.error);
    } catch (e) {
      toast.error('TTS server test failed');
    }
  };

  return (
    <>
      <Card title="Local TTS server" description="Any OpenAI-compatible speech server (Kokoro-FastAPI, openedai-speech, LocalAI). Its voices appear in the reader for every user while it's reachable.">
        <Grid>
          <Field label="Server URL" wide>
            <TextInput value={settings.tts_openai_base_url} onChange={(v) => set('tts_openai_base_url', v)} placeholder="http://192.168.1.75:8880/v1" />
          </Field>
          <Field label="Model"><TextInput value={settings.tts_openai_model} onChange={(v) => set('tts_openai_model', v)} placeholder="kokoro" /></Field>
          <Field label="Default voice"><TextInput value={settings.tts_openai_voice} onChange={(v) => set('tts_openai_voice', v)} placeholder="af_heart" /></Field>
          <Field label="API key" help="Not needed for Kokoro."><TextInput type="password" value={settings.tts_openai_api_key} onChange={(v) => set('tts_openai_api_key', v)} /></Field>
        </Grid>
        <div className="s-row"><button type="button" className="s-btn" onClick={testServer}>Save &amp; test server</button></div>
      </Card>

      <Card title="Your narration defaults" description="Used by Narrate (TTS) when you haven't picked a voice in the reader.">
        <Grid>
          <Field label="Provider">
            <Select value={tts.provider} options={PROVIDERS} onChange={(v) => { setTts({ ...tts, provider: v }); loadVoices(v); }} />
          </Field>
          <Field label="Voice">
            <Select value={tts.voiceName} onChange={(v) => setTts({ ...tts, voiceName: v })}
              options={voices.length ? voices.map(v => ({ value: v.id, label: v.name })) : [{ value: '', label: 'No voices available' }]} />
          </Field>
          <Field label="Speed">
            <Select value={String(tts.speed)} onChange={(v) => setTts({ ...tts, speed: parseFloat(v) })}
              options={['0.75', '1', '1.25', '1.5', '2'].map(s => ({ value: s, label: `${s}×` }))} />
          </Field>
          {tts.provider === 'google' && (
            <Field label="Language code"><TextInput value={tts.languageCode} onChange={(v) => setTts({ ...tts, languageCode: v })} placeholder="en-US" /></Field>
          )}
        </Grid>
        <div className="s-row"><button type="button" className="s-btn s-btn--primary" onClick={saveTts}>Save narration defaults</button></div>
        <p className="s-field__help">Cloud providers need keys in the server environment: GOOGLE_TTS_KEY_PATH, OPENAI_API_KEY or ELEVENLABS_API_KEY.</p>
      </Card>
    </>
  );
};

export default TtsSection;
