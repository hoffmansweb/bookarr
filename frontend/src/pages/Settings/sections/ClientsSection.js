import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { downloadClientAPI } from '../../../services/api';
import { Card, Field, TextInput, Select, Switch, Grid, Badge } from '../ui';

const TYPES = [
  { value: 'qbittorrent', label: 'qBittorrent', port: 8080 },
  { value: 'sabnzbd', label: 'SABnzbd', port: 8080 },
  { value: 'nzbget', label: 'NZBGet', port: 6789 },
  { value: 'transmission', label: 'Transmission', port: 9091 },
  { value: 'deluge', label: 'Deluge', port: 8112 },
  { value: 'jdownloader2', label: 'JDownloader 2', port: 9666 },
  { value: 'aria2', label: 'aria2', port: 6800 }
];
const typeLabel = (t) => TYPES.find(x => x.value === t)?.label || t;
const EMPTY = { name: '', type: 'qbittorrent', host: '', port: 8080, apiKey: '', username: '', password: '', useSsl: false, category: 'books', mediaType: 'both', enabled: true };

const ClientForm = ({ initial, onSaved, onCancel }) => {
  const [form, setForm] = useState(initial || EMPTY);
  const [busy, setBusy] = useState(false);
  const f = (k) => (v) => setForm(prev => ({ ...prev, [k]: v }));
  const isQb = form.type === 'qbittorrent';
  const qbKey = isQb && /^qbt_/i.test(form.apiKey || '');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (initial?.id) await downloadClientAPI.update(initial.id, form);
      else await downloadClientAPI.create(form);
      toast.success(`Download client ${initial?.id ? 'updated' : 'added'}`);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save client');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    try {
      const { data } = await downloadClientAPI.test(form);
      toast.success(data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Connection failed');
    }
  };

  return (
    <form onSubmit={submit} className="s-form" aria-label={initial?.id ? `Edit ${initial.name}` : 'Add download client'}>
      <Grid>
        <Field label="Type">
          <Select value={form.type} options={TYPES} onChange={(v) => setForm(prev => ({ ...prev, type: v, port: initial?.id ? prev.port : TYPES.find(t => t.value === v).port }))} />
        </Field>
        <Field label="Name"><TextInput value={form.name} onChange={f('name')} required placeholder="e.g. qBittorrent" /></Field>
        <Field label="Host" help="IP or hostname, without http://"><TextInput value={form.host} onChange={f('host')} required placeholder="192.168.1.75" /></Field>
        <Field label="Port"><TextInput type="number" value={form.port} onChange={f('port')} required /></Field>

        {isQb && (
          <Field label="API key" help="qBittorrent 5.2+: WebUI → Options → WebUI → API Key (starts with qbt_). Recommended — no username/password needed." wide>
            <TextInput type="password" value={form.apiKey} onChange={f('apiKey')} placeholder="qbt_…" />
          </Field>
        )}
        {(['transmission', 'deluge', 'jdownloader2'].includes(form.type) || (isQb && !qbKey)) && (
          <>
            {form.type !== 'deluge' && <Field label="Username"><TextInput value={form.username} onChange={f('username')} /></Field>}
            <Field label="Password"><TextInput type="password" value={form.password} onChange={f('password')} /></Field>
          </>
        )}
        {['sabnzbd', 'nzbget'].includes(form.type) && (
          <Field label={form.type === 'nzbget' ? 'Password' : 'API key'}>
            <TextInput type="password" value={form.apiKey} onChange={f('apiKey')} required />
          </Field>
        )}
        {form.type === 'aria2' && (
          <Field label="RPC secret" help="Optional (--rpc-secret)"><TextInput type="password" value={form.apiKey} onChange={f('apiKey')} /></Field>
        )}

        <Field label="Category / folder" help="Category (qBittorrent, SABnzbd, NZBGet) or download folder (Transmission, Deluge).">
          <TextInput value={form.category} onChange={f('category')} />
        </Field>
        <Field label="Used for">
          <Select value={form.mediaType} onChange={f('mediaType')} options={[
            { value: 'both', label: 'Ebooks and audiobooks' }, { value: 'ebook', label: 'Ebooks only' }, { value: 'audiobook', label: 'Audiobooks only' }
          ]} />
        </Field>
      </Grid>
      <Switch label="Use HTTPS" checked={form.useSsl} onChange={f('useSsl')} />
      <div className="s-row s-row--end">
        <button type="button" className="s-btn s-btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="s-btn" onClick={test}>Test connection</button>
        <button type="submit" className="s-btn s-btn--primary" disabled={busy}>{busy ? 'Saving…' : initial?.id ? 'Save changes' : 'Add client'}</button>
      </div>
    </form>
  );
};

const ClientsSection = () => {
  const [clients, setClients] = useState([]);
  const [editing, setEditing] = useState(null); // client object, 'new', or null

  const load = () => downloadClientAPI.getAll().then(({ data }) => setClients(data)).catch(() => toast.error('Failed to load clients'));
  useEffect(() => { load(); }, []);

  const remove = async (c) => {
    if (!window.confirm(`Delete download client "${c.name}"?`)) return;
    try {
      await downloadClientAPI.delete(c.id);
      toast.success('Client deleted');
      load();
    } catch (e) {
      toast.error('Failed to delete client');
    }
  };

  const toggle = async (c) => {
    try {
      await downloadClientAPI.update(c.id, { ...c, enabled: !c.enabled });
      load();
    } catch (e) {
      toast.error('Failed to update client');
    }
  };

  const test = async (c) => {
    try {
      const { data } = await downloadClientAPI.test(c);
      toast.success(`${c.name}: ${data.message}`);
    } catch (e) {
      toast.error(`${c.name}: ${e.response?.data?.message || 'Connection failed'}`);
    }
  };

  return (
    <>
      <Card
        title="Download clients"
        description="Torrent and Usenet clients Bookarr sends releases to. Anna's Archive and web audiobooks don't need one."
        actions={editing !== 'new' && <button type="button" className="s-btn s-btn--primary" onClick={() => setEditing('new')}>+ Add client</button>}
      >
        {editing === 'new' && <ClientForm onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}

        <ul className="s-list">
          {clients.map(c => (
            <li key={c.id} className="s-list__item">
              {editing?.id === c.id ? (
                <ClientForm initial={{ ...EMPTY, ...c, apiKey: c.apiKey || '', username: c.username || '', password: c.password || '' }}
                  onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
              ) : (
                <div className="s-list__row">
                  <div className="s-list__main">
                    <span className="s-list__title">{c.name}</span>
                    <span className="s-list__meta">
                      {typeLabel(c.type)} · {c.host}:{c.port} · {c.mediaType === 'both' || !c.mediaType ? 'ebooks + audiobooks' : `${c.mediaType}s`}
                      {c.type === 'qbittorrent' && /^qbt_/i.test(c.apiKey || '') ? ' · API key' : ''}
                    </span>
                  </div>
                  <Badge tone={c.enabled ? 'ok' : 'off'}>{c.enabled ? 'Enabled' : 'Disabled'}</Badge>
                  <div className="s-list__actions">
                    <button type="button" className="s-btn s-btn--sm" onClick={() => test(c)}>Test</button>
                    <button type="button" className="s-btn s-btn--sm" onClick={() => toggle(c)}>{c.enabled ? 'Disable' : 'Enable'}</button>
                    <button type="button" className="s-btn s-btn--sm" onClick={() => setEditing(c)}>Edit</button>
                    <button type="button" className="s-btn s-btn--sm s-btn--danger" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}>Delete</button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {clients.length === 0 && editing !== 'new' && <li className="s-empty">No download clients yet.</li>}
        </ul>
      </Card>
    </>
  );
};

export default ClientsSection;
