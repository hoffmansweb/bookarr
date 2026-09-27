import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { settingsAPI } from '../../services/api';
import AmazonIntegration from '../../components/AmazonIntegration';
import AdminSettings from '../AdminSettings';
import SystemStatus from '../SystemStatus';
import GeneralSection from './sections/GeneralSection';
import PrioritySection from './sections/PrioritySection';
import SourcesSection from './sections/SourcesSection';
import ClientsSection from './sections/ClientsSection';
import IndexersSection from './sections/IndexersSection';
import TtsSection from './sections/TtsSection';
import JobsSection from './sections/JobsSection';
import './Settings.css';

// Sections that edit the shared settings table use the page-level save bar;
// the others (clients, indexers, users...) save each item directly.
const GROUPS = [
  {
    label: 'Library',
    items: [
      { id: 'general', label: 'General', icon: '⚙️', desc: 'Library folders, Get behaviour and backups', usesSettings: true, render: (p) => <GeneralSection {...p} /> },
      { id: 'priority', label: 'Download priority', icon: '🔀', desc: 'Which sources to try first for ebooks and audiobooks', usesSettings: true, render: (p) => <PrioritySection {...p} /> },
      { id: 'sources', label: 'Sources', icon: '🌐', desc: "Anna's Archive, audiobook search, conversion and Audiobookshelf", usesSettings: true, render: (p) => <SourcesSection {...p} /> }
    ]
  },
  {
    label: 'Downloads',
    items: [
      { id: 'clients', label: 'Download clients', icon: '⬇️', desc: 'qBittorrent, SABnzbd and other clients', render: () => <ClientsSection /> },
      { id: 'indexers', label: 'Indexers', icon: '🔎', desc: 'Prowlarr, Jackett and Newznab/Torznab indexers', render: (p) => <IndexersSection {...p} /> }
    ]
  },
  {
    label: 'Reading & listening',
    items: [
      { id: 'tts', label: 'Text-to-speech', icon: '🗣️', desc: 'Kokoro / local TTS server and narration defaults', usesSettings: true, render: (p) => <TtsSection {...p} /> },
      { id: 'amazon', label: 'Amazon', icon: '📦', desc: 'Import your Amazon library', render: () => <AmazonIntegration /> }
    ]
  },
  {
    label: 'Administration',
    items: [
      { id: 'users', label: 'User management', icon: '👥', desc: 'Users, roles and your password', render: () => <AdminSettings embedded /> },
      { id: 'system', label: 'System', icon: '🖥️', desc: 'Health, versions and logs', render: () => <SystemStatus embedded /> },
      { id: 'jobs', label: 'Jobs', icon: '⏱️', desc: 'Scheduled tasks — run them on demand', render: () => <JobsSection /> }
    ]
  }
];
const SECTIONS = GROUPS.flatMap(g => g.items);

const Settings = () => {
  const { section: sectionParam } = useParams();
  const navigate = useNavigate();
  const section = SECTIONS.find(s => s.id === sectionParam) || SECTIONS[0];

  const [saved, setSaved] = useState({});   // last loaded/saved values
  const [draft, setDraft] = useState({});   // values on screen
  const [saving, setSaving] = useState(false);
  const headingRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await settingsAPI.getAll();
      setSaved(data);
      setDraft(data);
    } catch (e) {
      toast.error('Failed to load settings');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Move focus to the section heading when switching sections (screen readers announce it)
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [section.id]);

  const changedKeys = useMemo(
    () => Object.keys({ ...saved, ...draft }).filter(k => (draft[k] ?? '') !== (saved[k] ?? '')),
    [saved, draft]
  );
  const dirty = changedKeys.length > 0;

  const set = useCallback((key, value) => setDraft(prev => ({ ...prev, [key]: value })), []);

  const saveNow = useCallback(async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      // Only send what changed; an empty value clears the setting server-side
      const patch = Object.fromEntries(changedKeys.map(k => [k, draft[k] ?? '']));
      await settingsAPI.update(patch);
      setSaved(draft);
      toast.success('Settings saved');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save settings');
      throw e;
    } finally {
      setSaving(false);
    }
  }, [dirty, changedKeys, draft]);

  // Warn before leaving the page with unsaved changes
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Ctrl/Cmd+S saves
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dirty) {
        e.preventDefault();
        saveNow().catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saveNow]);

  const go = (id) => navigate(`/settings/${id}`);
  const sectionProps = { settings: draft, set, saveNow, reload: load };

  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="Settings sections">
        <h1 className="settings__title">Settings</h1>
        {GROUPS.map(group => (
          <div key={group.label} className="settings__group">
            <h2 className="settings__group-label">{group.label}</h2>
            <ul>
              {group.items.map(item => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`settings__nav-item${item.id === section.id ? ' is-active' : ''}`}
                    aria-current={item.id === section.id ? 'page' : undefined}
                    onClick={() => go(item.id)}
                  >
                    <span aria-hidden="true" className="settings__nav-icon">{item.icon}</span>
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <main className="settings__main" aria-labelledby="settings-section-title">
        <header className="settings__header">
          <h2 id="settings-section-title" ref={headingRef} tabIndex={-1}>
            <span aria-hidden="true">{section.icon} </span>{section.label}
          </h2>
          <p className="s-muted">{section.desc}</p>
        </header>

        <div className="settings__content">{section.render(sectionProps)}</div>

        {dirty && (
          <div className="settings__savebar" role="region" aria-label="Unsaved changes">
            <span>
              <strong>{changedKeys.length}</strong> unsaved change{changedKeys.length === 1 ? '' : 's'}
              {!section.usesSettings && ' (from another section)'}
            </span>
            <div className="s-row">
              <button type="button" className="s-btn s-btn--ghost" onClick={() => setDraft(saved)} disabled={saving}>Discard</button>
              <button type="button" className="s-btn s-btn--primary" onClick={() => saveNow().catch(() => {})} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Settings;
