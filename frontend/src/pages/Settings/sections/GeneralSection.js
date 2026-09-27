import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { settingsAPI } from '../../../services/api';
import { Card, Field, TextInput, Select, Switch, Grid, settingBool } from '../ui';
import FolderPicker from '../FolderPicker';

const FolderField = ({ label, help, value, onChange, onBrowse, placeholder }) => (
  <Field label={label} help={help} wide>
    <div className="s-input-group">
      <TextInput value={value} onChange={onChange} placeholder={placeholder} />
      <button type="button" className="s-btn" onClick={onBrowse}>Browse…</button>
    </div>
  </Field>
);

const GeneralSection = ({ settings, set, reload }) => {
  const [picker, setPicker] = useState(null); // { key, title }

  const handleExport = async () => {
    try {
      const { data } = await settingsAPI.getAll();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bookarr-settings.json';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Settings exported (contains API keys — store it safely)');
    } catch (e) {
      toast.error('Export failed');
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      await settingsAPI.import(JSON.parse(await file.text()));
      toast.success('Settings imported');
      reload();
    } catch (err) {
      toast.error('Import failed — is this a Bookarr settings file?');
    }
  };

  return (
    <>
      <Card title="Getting books" description="What happens when you click Get on a book.">
        <Grid>
          <Field label='When I click "Get", look for' help="Both creates an ebook and an audiobook entry and searches for each.">
            <Select
              value={settings.auto_get_formats || 'both'}
              onChange={(v) => set('auto_get_formats', v)}
              options={[
                { value: 'both', label: '📖 Ebook + 🎧 Audiobook' },
                { value: 'ebook', label: '📖 Ebook only' },
                { value: 'audiobook', label: '🎧 Audiobook only' }
              ]}
            />
          </Field>
          <Field label="Status for books added by author monitoring">
            <Select
              value={settings.default_book_status || 'wanted'}
              onChange={(v) => set('default_book_status', v)}
              options={[
                { value: 'wanted', label: 'Wanted (search automatically)' },
                { value: 'ignored', label: 'Ignored' },
                { value: 'available', label: 'Available' }
              ]}
            />
          </Field>
        </Grid>
      </Card>

      <Card title="Reading & listening" description="What happens while you read or listen.">
        <Switch
          label="Star books when I start reading or listening"
          help="The first time a book saves reading or listening progress it is filed under Favorites (⭐) on the Dashboard. If you clear the star yourself, it stays cleared."
          checked={settingBool(settings, 'auto_star_on_start')}
          onChange={(v) => set('auto_star_on_start', v ? 'true' : 'false')}
        />
      </Card>

      <Card title="Automation" description="Tuning for the scheduled jobs (see Administration → Jobs).">
        <Switch
          label="Auto-Narrate new Ebooks"
          help="When a new EPUB is downloaded and no audiobook version exists, automatically queue it for Kokoro TTS Narration in the background."
          checked={settingBool(settings, 'auto_narrate')}
          onChange={(v) => set('auto_narrate', v ? 'true' : 'false')}
        />
        <Grid>
          <Field label="Books per auto-search run" help="Wanted books searched every 2 hours, least recently searched first.">
            <TextInput type="number" min="1" max="200" value={settings.auto_search_batch} onChange={(v) => set('auto_search_batch', v)} placeholder="20" />
          </Field>
          <Field label="Retry stalled downloads after (hours)" help="A client download that hasn't finished by then is retried with a different release.">
            <TextInput type="number" min="1" value={settings.download_stall_hours} onChange={(v) => set('download_stall_hours', v)} placeholder="48" />
          </Field>
          <Field label="Database backups to keep" help="Nightly backups are saved in a backups folder next to the database.">
            <TextInput type="number" min="1" value={settings.db_backup_keep} onChange={(v) => set('db_backup_keep', v)} placeholder="7" />
          </Field>
        </Grid>
      </Card>

      
      <Card title="Notifications" description="Send alerts when books finish downloading.">
        <Grid>
          <Field label="Discord Webhook URL" help="Paste your Discord webhook URL here to receive notifications.">
            <TextInput type="password" value={settings.discord_webhook_url || ''} onChange={(v) => set('discord_webhook_url', v)} placeholder="https://discord.com/api/webhooks/..." />
          </Field>
        </Grid>
      </Card>

      <Card title="Lists" description="Automatically import books from external services.">
        <Grid>
          <Field label="Goodreads 'Want to Read' RSS URL" help="Go to 'My Books' on Goodreads, click 'RSS' at the bottom, and paste the link here.">
            <TextInput type="password" value={settings.goodreads_rss_url || ''} onChange={(v) => set('goodreads_rss_url', v)} placeholder="https://www.goodreads.com/review/list_rss/..." />
          </Field>
        </Grid>
      </Card>

      <Card title="Library folders"
 description="Where finished books are stored. Docker: use /library/ebooks and /library/audiobooks.">
        <FolderField label="Ebooks folder" value={settings.ebooks_folder} onChange={(v) => set('ebooks_folder', v)}
          placeholder="/library/ebooks or D:\Books\Ebooks" onBrowse={() => setPicker({ key: 'ebooks_folder', title: 'Choose ebooks folder' })} />
        <FolderField label="Audiobooks folder" value={settings.audiobooks_folder} onChange={(v) => set('audiobooks_folder', v)}
          placeholder="/library/audiobooks or D:\Books\Audiobooks" onBrowse={() => setPicker({ key: 'audiobooks_folder', title: 'Choose audiobooks folder' })} />
        <FolderField label="Completed downloads folder" help="Where your download clients put finished downloads, as seen from Bookarr."
          value={settings.download_folder} onChange={(v) => set('download_folder', v)}
          placeholder="/downloads or \\server\downloads\complete" onBrowse={() => setPicker({ key: 'download_folder', title: 'Choose downloads folder' })} />
      </Card>

      <Card title="Network shares" description="Only needed when a folder above is a Windows share (\\server\share) that requires a login.">
        <Grid>
          <Field label="Library share username"><TextInput value={settings.network_username} onChange={(v) => set('network_username', v)} placeholder="DOMAIN\user" /></Field>
          <Field label="Library share password"><TextInput type="password" value={settings.network_password} onChange={(v) => set('network_password', v)} /></Field>
          <Field label="Downloads share username"><TextInput value={settings.download_network_username} onChange={(v) => set('download_network_username', v)} placeholder="DOMAIN\user" /></Field>
          <Field label="Downloads share password"><TextInput type="password" value={settings.download_network_password} onChange={(v) => set('download_network_password', v)} /></Field>
        </Grid>
      </Card>

      <Card title="Metadata" description="Optional accounts used to look up book details.">
        <Grid>
          <Field label="Google Books API key" help="Raises Google Books rate limits for search and metadata. Without a key the smaller anonymous quota applies.">
            <TextInput type="password" value={settings.google_books_api_key} onChange={(v) => set('google_books_api_key', v)} />
          </Field>
          <Field label="Google Books timeout (ms)" help="How long a request may take before it is dropped. Google Books can stall instead of answering once its quota is used up. Default 10000.">
            <TextInput type="number" min="1000" max="60000" value={settings.google_books_timeout_ms} onChange={(v) => set('google_books_timeout_ms', v)} placeholder="10000" />
          </Field>
          <Field label="Z-Library email"><TextInput value={settings.zlibrary_username} onChange={(v) => set('zlibrary_username', v)} placeholder="you@example.com" /></Field>
          <Field label="Z-Library password"><TextInput type="password" value={settings.zlibrary_password} onChange={(v) => set('zlibrary_password', v)} /></Field>
        </Grid>
        <Switch
          label="Use Google Books"
          help="Turn off if Google keeps limiting the app (HTTP 429 once its daily quota is used up). Open Library still supplies descriptions, ISBNs and covers."
          checked={settingBool(settings, 'google_books_enabled')}
          onChange={(v) => set('google_books_enabled', v ? 'true' : 'false')}
        />
      </Card>

      <Card title="API Access" description="Use this API Key to authenticate external applications and integrations with Bookarr.">
        <Grid>
          <Field label="API Key">
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <TextInput type="password" value={settings.api_key || ''} onChange={(v) => set('api_key', v)} readOnly={!settings.api_key} />
              {settings.api_key && (
                <button 
                  type="button" 
                  className="s-btn" 
                  onClick={() => { navigator.clipboard.writeText(settings.api_key); toast.success('API Key copied to clipboard'); }}
                  style={{ padding: '6px 12px' }}
                >
                  ?? Copy
                </button>
              )}
            </div>
          </Field>
        </Grid>
      </Card>

      <Card title="Backup" description="Export or restore all settings. The export includes API keys and passwords.">
        <div className="s-row">
          <button type="button" className="s-btn" onClick={handleExport}>⬇️ Export settings</button>
          <label className="s-btn s-file-btn">
            ⬆️ Import settings
            <input type="file" accept=".json,application/json" onChange={handleImport} className="s-visually-hidden" />
          </label>
        </div>
      </Card>

      {picker && (
        <FolderPicker
          title={picker.title}
          initialPath={settings[picker.key]}
          onClose={() => setPicker(null)}
          onSelect={(p) => { set(picker.key, p); setPicker(null); }}
        />
      )}
    </>
  );
};

export default GeneralSection;
