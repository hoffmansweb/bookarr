import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { indexerAPI } from '../services/api';
import { Field, TextInput, Badge } from '../pages/Settings/ui';

const SOURCES = {
  prowlarr: {
    label: 'Prowlarr',
    placeholder: 'http://192.168.1.75:9696',
    keyHelp: 'Prowlarr → Settings → General → API Key'
  },
  jackett: {
    label: 'Jackett',
    placeholder: 'http://192.168.1.75:9117',
    keyHelp: 'API Key shown at the top of the Jackett dashboard'
  }
};

const catLabel = (cats) => cats.split(',').map(c => ({ 3030: 'Audiobook', 7000: 'Books', 7020: 'EBook' }[c] || c)).join(', ');

// Connect to Prowlarr or Jackett, list their indexers, and add the chosen ones as Bookarr indexers
const IndexerConnect = ({ kind, settings, onClose, onSynced }) => {
  const src = SOURCES[kind];
  const [url, setUrl] = useState(settings[`${kind}_url`] || '');
  const [apiKey, setApiKey] = useState(settings[`${kind}_api_key`] || '');
  const [found, setFound] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [removeMissing, setRemoveMissing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleDiscover = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const { data } = await indexerAPI.discover(kind, url, apiKey);
      setFound(data.indexers);
      // Pre-select book-capable indexers that are enabled remotely and not added yet
      setSelected(new Set(data.indexers.filter(i => i.supportsBooks && i.remoteEnabled && !i.existingId).map(i => i.remoteId)));
      const books = data.indexers.filter(i => i.supportsBooks).length;
      toast.success(`Found ${data.indexers.length} indexers (${books} with books/audiobooks)`);
    } catch (error) {
      toast.error(error.response?.data?.error || `Could not connect to ${src.label}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const handleSync = async (ids) => {
    setBusy(true);
    try {
      const { data } = await indexerAPI.sync({ kind, url, apiKey, remoteIds: ids, removeMissing });
      toast.success(`${src.label}: ${data.added} added, ${data.updated} updated${data.removed ? `, ${data.removed} removed` : ''}`);
      onSynced();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  const visible = (found || []).filter(i => showAll || i.supportsBooks);

  return (
    <div className="s-form" role="region" aria-label={`Connect ${src.label}`}>
      <h4 className="s-card__title">Connect {src.label}</h4>
      <form onSubmit={handleDiscover} className="s-card__body">
        <div className="s-grid">
          <Field label={`${src.label} URL`}>
            <TextInput placeholder={src.placeholder} value={url} onChange={setUrl} required />
          </Field>
          <Field label="API key" help={src.keyHelp}>
            <TextInput type="password" value={apiKey} onChange={setApiKey} required />
          </Field>
        </div>
        <div className="s-row">
          <button type="submit" className="s-btn" disabled={busy}>{busy && !found ? 'Connecting…' : found ? 'Refresh list' : 'Find indexers'}</button>
          <button type="button" className="s-btn s-btn--primary" disabled={busy} onClick={() => handleSync(undefined)}>
            ⚡ Auto-add all book indexers
          </button>
          <button type="button" className="s-btn s-btn--ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>

      {found && (
        <>
          <div className="s-row" style={{ justifyContent: 'space-between' }}>
            <strong aria-live="polite">{selected.size} selected</strong>
            <label className="s-row" style={{ gap: '8px' }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show indexers without book categories
            </label>
          </div>
          <ul className="s-priority" style={{ maxHeight: '420px', overflowY: 'auto' }} aria-label={`${src.label} indexers`}>
            {visible.map(ix => (
              <li key={ix.remoteId}>
                <label className={`s-priority__item${ix.remoteEnabled ? '' : ' is-off'}`} style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.has(ix.remoteId)} onChange={() => toggle(ix.remoteId)} />
                  <div className="s-priority__text">
                    <span className="s-priority__label">{ix.name}</span>
                    <span className="s-field__help">
                      {ix.protocol === 'usenet' ? '📰 Usenet' : '🧲 Torrent'}
                      {ix.privacy ? ` · ${ix.privacy}` : ''}
                      {ix.supportsBooks ? ` · ${catLabel(ix.categories)}` : ' · no book categories'}
                      {!ix.remoteEnabled ? ` · disabled in ${src.label}` : ''}
                    </span>
                  </div>
                  {ix.existingId && <Badge tone="info">Already added</Badge>}
                </label>
              </li>
            ))}
            {visible.length === 0 && <li className="s-empty">No indexers with book categories. Tick "Show indexers without book categories" to see all.</li>}
          </ul>
          <label className="s-row" style={{ gap: '8px' }}>
            <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} />
            Remove Bookarr indexers that no longer exist in {src.label}
          </label>
          <div className="s-row s-row--end">
            <button type="button" className="s-btn s-btn--primary" disabled={busy || (selected.size === 0 && !removeMissing)} onClick={() => handleSync([...selected])}>
              {busy ? 'Saving…' : `Add / update ${selected.size} indexer${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default IndexerConnect;
