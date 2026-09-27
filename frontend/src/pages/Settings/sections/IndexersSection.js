import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { indexerAPI, settingsAPI } from '../../../services/api';
import { Switch } from '../ui';
import { Card, Field, TextInput, Select, Grid, Badge } from '../ui';
import IndexerConnect from '../../../components/IndexerConnect';

const CAT_NAMES = { 3030: 'Audiobook', 7000: 'Books', 7020: 'EBook' };
const catLabel = (cats) => String(cats || '').split(',').filter(Boolean).map(c => CAT_NAMES[c.trim()] || c.trim()).join(', ');
const EMPTY = { name: '', type: 'newznab', url: '', apiKey: '', priority: 50, categories: '3030,7000,7020' };

const IndexerForm = ({ initial, onSaved, onCancel }) => {
  const [form, setForm] = useState(initial || EMPTY);
  const f = (k) => (v) => setForm(prev => ({ ...prev, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (initial?.id) await indexerAPI.update(initial.id, form);
      else await indexerAPI.create(form);
      toast.success(`Indexer ${initial?.id ? 'updated' : 'added'}`);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save indexer');
    }
  };

  const test = async () => {
    try {
      const { data } = await indexerAPI.test(form);
      toast.success(data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Connection failed');
    }
  };

  return (
    <form onSubmit={submit} className="s-form" aria-label={initial?.id ? `Edit ${initial.name}` : 'Add indexer'}>
      <Grid>
        <Field label="Name"><TextInput value={form.name} onChange={f('name')} required /></Field>
        <Field label="Type">
          <Select value={form.type} onChange={f('type')} options={[
            { value: 'newznab', label: 'Newznab / Torznab (usenet or Prowlarr indexer)' },
            { value: 'jackett', label: 'Jackett indexer' }
          ]} />
        </Field>
        <Field label="Feed URL" help="With or without the trailing /api." wide>
          <TextInput value={form.url} onChange={f('url')} required
            placeholder={form.type === 'jackett' ? 'http://jackett:9117/api/v2.0/indexers/<id>/results/torznab' : 'https://api.nzbgeek.info or http://prowlarr:9696/<id>'} />
        </Field>
        <Field label="API key"><TextInput type="password" value={form.apiKey} onChange={f('apiKey')} required /></Field>
        <Field label="Priority" help="Higher is tried first when results tie."><TextInput type="number" value={form.priority} onChange={f('priority')} /></Field>
        <Field label="Categories" help="3030 = Audiobook, 7000 = Books, 7020 = EBook" wide>
          <TextInput value={form.categories} onChange={f('categories')} />
        </Field>
      </Grid>
      <div className="s-row s-row--end">
        <button type="button" className="s-btn s-btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="s-btn" onClick={test}>Test</button>
        <button type="submit" className="s-btn s-btn--primary">{initial?.id ? 'Save changes' : 'Add indexer'}</button>
      </div>
    </form>
  );
};

const IndexersSection = ({ settings, reload }) => {
  const [indexers, setIndexers] = useState([]);
  const [editing, setEditing] = useState(null); // indexer, 'new', or null
  const [connectKind, setConnectKind] = useState(null);

  const load = () => indexerAPI.getAll().then(({ data }) => setIndexers(data)).catch(() => toast.error('Failed to load indexers'));
  useEffect(() => { load(); }, []);

  const remove = async (ix) => {
    if (!window.confirm(`Delete indexer "${ix.name}"?`)) return;
    try {
      await indexerAPI.delete(ix.id);
      toast.success('Indexer deleted');
      load();
    } catch (e) {
      toast.error('Failed to delete indexer');
    }
  };
  const toggle = async (ix) => {
    try {
      await indexerAPI.update(ix.id, { enabled: !ix.enabled });
      load();
    } catch (e) {
      toast.error('Failed to update indexer');
    }
  };
  const test = async (ix) => {
    try {
      const { data } = await indexerAPI.test(ix);
      toast.success(`${ix.name}: ${data.message}`);
    } catch (e) {
      toast.error(`${ix.name}: ${e.response?.data?.message || 'Connection failed'}`);
    }
  };

  return (
    <>
      <Card title="Import from Prowlarr or Jackett" description="Finds your configured indexers and adds the ones with book or audiobook categories.">
        <div className="s-row">
          <button type="button" className={`s-btn${connectKind === 'prowlarr' ? ' s-btn--primary' : ''}`} aria-pressed={connectKind === 'prowlarr'}
            onClick={() => { setConnectKind(connectKind === 'prowlarr' ? null : 'prowlarr'); setEditing(null); }}>🔗 Connect Prowlarr</button>
          <button type="button" className={`s-btn${connectKind === 'jackett' ? ' s-btn--primary' : ''}`} aria-pressed={connectKind === 'jackett'}
            onClick={() => { setConnectKind(connectKind === 'jackett' ? null : 'jackett'); setEditing(null); }}>🔗 Connect Jackett</button>
        </div>
        {connectKind && (
          <IndexerConnect key={connectKind} kind={connectKind} settings={settings}
            onClose={() => setConnectKind(null)} onSynced={() => { load(); reload(); }} />
        )}
      </Card>

      <Card
        title={`Indexers (${indexers.length})`}
        actions={editing !== 'new' && <button type="button" className="s-btn" onClick={() => { setEditing('new'); setConnectKind(null); }}>+ Add manually</button>}
      >
        {editing === 'new' && <IndexerForm onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}
        <ul className="s-list">
          {indexers.map(ix => (
            <li key={ix.id} className="s-list__item">
              {editing?.id === ix.id ? (
                <IndexerForm initial={{ ...EMPTY, ...ix }} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
              ) : (
                <div className="s-list__row">
                  <div className="s-list__main">
                    <span className="s-list__title">{ix.name}</span>
                    <span className="s-list__meta">{catLabel(ix.categories) || 'No categories'} · priority {ix.priority}</span>
                    <span className="s-list__meta s-truncate" title={ix.url}>{ix.url}</span>
                  </div>
                  <Badge tone={ix.enabled ? 'ok' : 'off'}>{ix.enabled ? 'Enabled' : 'Disabled'}</Badge>
                  <div className="s-list__actions">
                    <button type="button" className="s-btn s-btn--sm" onClick={() => test(ix)}>Test</button>
                    <button type="button" className="s-btn s-btn--sm" onClick={() => toggle(ix)}>{ix.enabled ? 'Disable' : 'Enable'}</button>
                    <button type="button" className="s-btn s-btn--sm" onClick={() => setEditing(ix)}>Edit</button>
                    <button type="button" className="s-btn s-btn--sm s-btn--danger" onClick={() => remove(ix)} aria-label={`Delete ${ix.name}`}>Delete</button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {indexers.length === 0 && editing !== 'new' && <li className="s-empty">No indexers yet — connect Prowlarr or Jackett above.</li>}
        </ul>
      </Card>
    </>
  );
};

export default IndexersSection;
