import React from 'react';
import { Card, Field, TextInput, Select, Switch, Grid, settingBool } from '../ui';

// Default audiobook source order (mirrors backend sourcePriority.js) — used when nothing is saved yet
const DEFAULT_AUDIOBOOK_ORDER = ['usenet', 'torrent', 'librivox', 'archive', 'youtube', 'web'];

const readAudiobookOrder = (settings) => {
  try {
    const saved = JSON.parse(settings.source_order_audiobook || 'null');
    if (Array.isArray(saved) && saved.length) {
      const ids = saved.map(s => s.id);
      return [...saved, ...DEFAULT_AUDIOBOOK_ORDER.filter(id => !ids.includes(id)).map(id => ({ id, enabled: true }))];
    }
  } catch (e) { /* fall through to defaults */ }
  return DEFAULT_AUDIOBOOK_ORDER.map(id => ({ id, enabled: true }));
};

const SourcesSection = ({ settings, set }) => {
  const annasOn = settingBool(settings, 'annas_archive_enabled');
  // YouTube on/off lives in the audiobook source-priority list (same switch as Download priority)
  const audiobookOrder = readAudiobookOrder(settings);
  const youtubeOn = audiobookOrder.find(s => s.id === 'youtube')?.enabled !== false;
  const setYoutube = (on) => set('source_order_audiobook', JSON.stringify(
    audiobookOrder.map(({ id, enabled }) => ({ id, enabled: id === 'youtube' ? on : enabled !== false }))
  ));
  return (
    <>
      <Card title="YouTube" description="Full-length audiobook uploads. Fast, but quality and legitimacy vary; short teaser/scam uploads are rejected automatically.">
        <Switch
          label="Search YouTube for audiobooks"
          help="When off, YouTube is skipped by Get, Auto Audiobook, auto-search and the Find Audiobook search. Same switch as in Download priority."
          checked={youtubeOn}
          onChange={setYoutube}
        />
      </Card>
      <Card title="Anna's Archive" description="Direct ebook downloads. Domains change often; the defaults are the current official mirrors.">
        <Switch label="Use Anna's Archive" checked={annasOn} onChange={(v) => set('annas_archive_enabled', v ? 'true' : 'false')} />
        {annasOn && (
          <Grid>
            <Field label="Mirrors" help="Comma-separated. Leave blank for the built-in list (.gl, .pk, .gd)." wide>
              <TextInput value={settings.annas_archive_domains} onChange={(v) => set('annas_archive_domains', v)} placeholder="annas-archive.gl, annas-archive.pk" />
            </Field>
            <Field label="Member key" help="Optional. Skips the slow-server countdown (from your Anna's account page).">
              <TextInput type="password" value={settings.annas_archive_key} onChange={(v) => set('annas_archive_key', v)} />
            </Field>
            <Field label="Downloader">
              <Select value={settings.annas_downloader || 'builtin'} onChange={(v) => set('annas_downloader', v)}
                options={[{ value: 'builtin', label: 'Built-in (recommended)' }, { value: 'aria2', label: 'aria2 download client' }]} />
            </Field>
            <Field label="Preferred formats" help="In order of preference.">
              <TextInput value={settings.annas_archive_formats} onChange={(v) => set('annas_archive_formats', v)} placeholder="epub,azw3,mobi,pdf" />
            </Field>
            <Field label="Language" help='Two-letter code, or "any".'>
              <TextInput value={settings.annas_archive_language} onChange={(v) => set('annas_archive_language', v)} placeholder="en" />
            </Field>
          </Grid>
        )}
      </Card>

      <Card title="Bot-check solving" description="Anna's Archive sits behind DDoS-Guard. Bookarr's built-in browser handles it; FlareSolverr is an optional helper.">
        <Field label="FlareSolverr URL" help="Tried first when set, e.g. http://flaresolverr:8191 in Docker.">
          <TextInput value={settings.flaresolverr_url} onChange={(v) => set('flaresolverr_url', v)} placeholder="http://192.168.1.75:8191" />
        </Field>
      </Card>

      <Card title="Audiobook web search" description="Used by the Web search source. SearXNG is the best way to get Google results.">
        <Grid>
          <Field label="SearXNG URL" help="Self-hosted; needs the json format enabled in settings.yml." wide>
            <TextInput value={settings.searxng_url} onChange={(v) => set('searxng_url', v)} placeholder="http://searxng:8080" />
          </Field>
          <Field label="Brave Search API key" help="Optional fallback (free tier available).">
            <TextInput type="password" value={settings.brave_search_key} onChange={(v) => set('brave_search_key', v)} />
          </Field>
          <Field label="Google Custom Search key" help="Legacy: closed to new users, shuts down 2027-01-01.">
            <TextInput type="password" value={settings.google_cse_key} onChange={(v) => set('google_cse_key', v)} />
          </Field>
          <Field label="Google Custom Search engine ID">
            <TextInput value={settings.google_cse_cx} onChange={(v) => set('google_cse_cx', v)} />
          </Field>
        </Grid>
      </Card>

      <Card title="Audiobook conversion" description="Downloaded audio is combined into one tagged, chaptered file.">
        <Grid>
          <Field label="Output">
            <Select value={settings.audiobook_format || 'm4b'} onChange={(v) => set('audiobook_format', v)}
              options={[{ value: 'm4b', label: 'Single M4B with chapters (recommended)' }, { value: 'original', label: 'Keep original files' }]} />
          </Field>
          <Field label="Bitrate">
            <Select value={settings.audiobook_bitrate || '64k'} onChange={(v) => set('audiobook_bitrate', v)}
              options={[{ value: '64k', label: '64 kbps (speech, small)' }, { value: '96k', label: '96 kbps' }, { value: '128k', label: '128 kbps' }]} />
          </Field>
          <Field label="Channels">
            <Select value={settings.audiobook_channels || '1'} onChange={(v) => set('audiobook_channels', v)}
              options={[{ value: '1', label: 'Mono' }, { value: '2', label: 'Stereo' }]} />
          </Field>
          <Field label="Minimum length (minutes)" help='Rejects short "full audiobook" teaser/scam uploads.'>
            <TextInput type="number" min="1" value={settings.audiobook_min_minutes} onChange={(v) => set('audiobook_min_minutes', v)} placeholder="20" />
          </Field>
        </Grid>
      </Card>

      <Card title="Audiobookshelf" description="Bookarr asks Audiobookshelf to rescan after each import.">
        <Grid>
          <Field label="Server URL" wide>
            <TextInput value={settings.abs_url} onChange={(v) => set('abs_url', v)} placeholder="http://192.168.1.75:13378" />
          </Field>
          <Field label="API token" help="Audiobookshelf → Settings → Users → your user → API token.">
            <TextInput type="password" value={settings.abs_api_key} onChange={(v) => set('abs_api_key', v)} />
          </Field>
          <Field label="Library IDs" help="Optional, comma-separated. Blank scans all libraries.">
            <TextInput value={settings.abs_library_ids} onChange={(v) => set('abs_library_ids', v)} />
          </Field>
        </Grid>
      </Card>
    </>
  );
};

export default SourcesSection;
