import React, { useState, useEffect, useRef, useCallback } from 'react';
import { bookAPI } from '../services/api';
import { useSocket } from '../context/SocketContext';
import { toast } from 'react-toastify';
import './AmazonIntegration.css';

// The scrape + import run is a single long lived HTTP request that can sit for
// minutes waiting on a manual Amazon login. Every bit of feedback below therefore
// comes over the `amazon:progress` socket event, which the backend emits as it
// works, so the user can watch what is found and what happens to each entry.
const STEPS = [
  { key: 'launch', label: 'Launch browser' },
  { key: 'login', label: 'Amazon login' },
  { key: 'scan', label: 'Scan my books' },
  { key: 'import', label: 'Import & enrich' }
];

// Which pipeline step each backend stage belongs to (4 === past the last step).
const STAGE_STEP = {
  idle: -1,
  launching: 0,
  navigating: 0,
  login: 1,
  'logged-in': 2,
  scraping: 2,
  scanned: 2,
  importing: 3,
  enriching: 3,
  complete: 4,
  failed: -1
};

const STAGE_TEXT = {
  idle: 'Idle',
  launching: 'Launching a Chromium browser window…',
  navigating: 'Opening amazon.com/your-books…',
  login: 'Waiting for you to log in in the browser window…',
  'logged-in': 'Login detected — reading your library…',
  scraping: 'Scanning the page for book entries…',
  scanned: 'Page scan finished',
  importing: 'Importing entries into your catalogue…',
  enriching: 'Fetching metadata for a new book…',
  complete: 'Import complete',
  failed: 'Import failed'
};

const ACTION_META = {
  skipped: { label: 'Skipped', cls: 'skip' },
  duplicate: { label: 'Already in library', cls: 'dup' },
  created: { label: 'Added', cls: 'new' },
  enriched: { label: 'Metadata found', cls: 'enr' }
};

const trim = (value, max = 80) => {
  if (!value) return '';
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const fmtTime = (ms) => {
  const seconds = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

const EMPTY_STATS = { found: 0, imported: 0, duplicates: 0, skipped: 0, enriched: 0 };

const AmazonIntegration = () => {
  const socket = useSocket();

  const [stage, setStage] = useState('idle');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stream, setStream] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [summary, setSummary] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  const rowsRef = useRef(new Map());   // index -> row (latest full state)
  const pendingRef = useRef([]);       // indexes waiting to be revealed
  const pumpingRef = useRef(false);
  const genRef = useRef(0);            // invalidates a previous run's reveal loop
  const startedRef = useRef(0);
  const logEndRef = useRef(null);
  const streamEndRef = useRef(null);

  const addLog = useCallback((message) => {
    if (!message) return;
    setLogs(prev => [...prev.slice(-199), `${new Date().toLocaleTimeString()}  ${message}`]);
  }, []);

  // Reveal cards one at a time so a 130 entry scan is watchable instead of instant.
  const pump = useCallback(() => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    const generation = genRef.current;
    const step = () => {
      if (generation !== genRef.current) return; // a newer run owns the queue now
      const id = pendingRef.current.shift();
      if (id === undefined) {
        pumpingRef.current = false;
        return;
      }
      const row = rowsRef.current.get(id);
      if (row) setStream(prev => [...prev, row].slice(-150));
      setTimeout(step, 150);
    };
    step();
  }, []);

  const upsertRow = useCallback((id, patch) => {
    if (id === undefined || id === null) return;
    const existing = rowsRef.current.get(id);
    const row = existing ? { ...existing, ...patch } : { id, ...patch };
    rowsRef.current.set(id, row);
    if (existing) {
      setStream(prev => prev.map(r => (r.id === id ? row : r)));
    } else {
      pendingRef.current.push(id);
      pump();
    }
  }, [pump]);

  // ---- live progress -------------------------------------------------------
  useEffect(() => {
    if (!socket) return undefined;

    const onProgress = (event) => {
      switch (event.stage) {
        case 'scanned':
          setStage('scanned');
          setStats(prev => ({ ...prev, found: event.total }));
          addLog(`Found ${event.total} entries on the page`);
          break;

        case 'book':
          setStage('importing');
          setStats(prev => {
            const next = { ...prev, found: event.total || prev.found };
            if (event.action === 'skipped') next.skipped += 1;
            if (event.action === 'duplicate') next.duplicates += 1;
            if (event.action === 'created') next.imported += 1;
            return next;
          });
          upsertRow(event.index, {
            title: event.book?.title,
            author: event.book?.author,
            coverUrl: event.book?.coverUrl,
            amazonAsin: event.book?.amazonAsin,
            action: event.action,
            message: event.message
          });
          addLog(`#${event.index}/${event.total} ${trim(event.book?.title, 60)} — ${event.message}`);
          break;

        case 'lookup':
          upsertRow(event.index, { enriching: true });
          addLog(`#${event.index} ${event.message}`);
          break;

        case 'enriching':
          upsertRow(event.index, { enriching: true });
          addLog(`#${event.index} looking up metadata for "${trim(event.book?.title, 50)}"`);
          break;

        case 'enriched':
          upsertRow(event.index, { enriching: false, action: event.fields?.length ? 'enriched' : 'created' });
          if (event.fields?.length) setStats(prev => ({ ...prev, enriched: prev.enriched + 1 }));
          addLog(`#${event.index} ${event.message}`);
          break;

        case 'complete':
          setStage('complete');
          setStats({
            found: event.found,
            imported: event.imported,
            duplicates: event.duplicates,
            skipped: event.skipped,
            enriched: event.enriched
          });
          setSummary(prev => ({ ...(prev || {}), ...event }));
          if (event.durationMs) setElapsed(event.durationMs);
          addLog(`Done in ${(event.durationMs / 1000).toFixed(1)}s — ${event.imported} new, ${event.duplicates} duplicate, ${event.skipped} skipped, ${event.asinLookedUp || 0} ASINs found by search, ${event.enriched} enriched`);
          break;

        case 'error':
        case 'failed':
          setStage('failed');
          if (event.durationMs) setElapsed(event.durationMs);
          addLog(`Failed: ${event.message}`);
          break;

        default:
          setStage(event.stage);
          addLog(event.message || STAGE_TEXT[event.stage] || event.stage);
      }
    };

    socket.on('amazon:progress', onProgress);
    return () => socket.off('amazon:progress', onProgress);
  }, [socket, addLog, upsertRow]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setElapsed(Date.now() - startedRef.current), 250);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ block: 'nearest' });
  }, [logs]);

  useEffect(() => {
    if (streamEndRef.current) streamEndRef.current.scrollIntoView({ block: 'nearest' });
  }, [stream]);

  // ---- run -----------------------------------------------------------------
  const startImport = async () => {
    if (running) return;

    genRef.current += 1;
    rowsRef.current = new Map();
    pendingRef.current = [];
    pumpingRef.current = false;
    startedRef.current = Date.now();

    setStream([]);
    setLogs([]);
    setSummary(null);
    setStats(EMPTY_STATS);
    setElapsed(0);
    setStage('launching');
    setRunning(true);
    addLog('Starting Amazon import…');

    try {
      const { data } = await bookAPI.getAmazonMyBooks();
      const result = data.stats || {};
      setStage('complete');
      setSummary(prev => ({ ...(prev || {}), ...result, books: data.books }));
      toast.success(`Amazon import finished — ${result.imported ?? data.books?.length ?? 0} new, ${result.duplicates ?? 0} already in your catalogue`);
    } catch (error) {
      setStage('failed');
      addLog(`Failed: ${error.response?.data?.error || error.message}`);
      toast.error(error.response?.data?.error || 'Amazon import failed');
    } finally {
      setRunning(false);
    }
  };

  const processed = stats.imported + stats.duplicates + stats.skipped;
  const percent = stats.found ? Math.min(100, Math.round((processed / stats.found) * 100)) : 0;
  const stepIndex = STAGE_STEP[stage] ?? -1;
  const headline = running
    ? (STAGE_TEXT[stage] || stage)
    : stage === 'failed'
      ? STAGE_TEXT.failed
      : stage === 'complete'
        ? STAGE_TEXT.complete
        : 'Idle — click “Import Amazon Books” to start';

  return (
    <div className="amazon-integration">
      <h2>Amazon My Books Integration</h2>

      <div className="amazon-actions">
        <button className="amz-run" onClick={startImport} disabled={running}>
          {running ? 'Import running…' : 'Import Amazon Books'}
        </button>
        <button className="amz-help-toggle" onClick={() => setShowHelp(v => !v)}>
          {showHelp ? 'Hide how it works' : 'How it works'}
        </button>
      </div>

      {!socket && (
        <p className="amz-muted">Not connected to the backend socket, so live progress cannot be shown.</p>
      )}

      {showHelp && (
        <div className="instructions-box">
          <h3>What happens when you click Import</h3>
          <ol>
            <li>A Chromium window opens on the machine running the backend.</li>
            <li>Log in to Amazon in that window — bookarr waits (up to 5 minutes), then starts scanning as soon as your library renders.</li>
            <li>Bookarr scrolls your whole library, then matches each book to your catalogue by ASIN (or title + author). New books are added as <code>wanted</code> with their author, and details are filled in from Google Books / Open Library.</li>
            <li>The panel below animates the whole run: each stage, every entry found, and exactly what happened to it.</li>
          </ol>
          <p>If an entry has no ASIN on the page, Bookarr searches Amazon for it by title and author, and still imports the book if none is found. Amazon's recommendations on the page are ignored.</p>
        </div>
      )}

      <div className={`amz-panel ${running ? 'is-running' : ''} ${stage === 'failed' ? 'is-failed' : ''}`}>
        <div className="amz-panel-head">
          <span className={`amz-live-dot ${running ? 'on' : ''} ${stage === 'failed' ? 'bad' : ''}`} />
          <span className="amz-stage-text">{headline}</span>
          <span className="amz-timer">{running || summary?.durationMs || stage === 'failed' ? fmtTime(elapsed) : '—'}</span>
        </div>

        <ol className="amz-pipeline">
          {STEPS.map((step, i) => (
            <li key={step.key} className={`amz-step ${stepIndex > i ? 'done' : stepIndex === i ? 'active' : ''}`}>
              <span className="amz-step-dot">{stepIndex > i ? '✓' : i + 1}</span>
              <span className="amz-step-label">{step.label}</span>
            </li>
          ))}
        </ol>

        <div className="amz-progress">
          <div
            className={`amz-progress-fill ${running && !stats.found ? 'indeterminate' : ''}`}
            style={{ width: stats.found ? `${percent}%` : undefined }}
          />
        </div>

        <div className="amz-stats">
          {[['Found', stats.found, 'found'], ['New', stats.imported, 'new'], ['Duplicate', stats.duplicates, 'dup'], ['Skipped', stats.skipped, 'skip'], ['Enriched', stats.enriched, 'enr']].map(([label, value, cls]) => (
            <div key={label} className={`amz-stat ${cls}`}>
              <span className="amz-stat-value" key={value}>{value}</span>
              <span className="amz-stat-label" key="label">{label}</span>
            </div>
          ))}
        </div>

        <div className="amz-browser">
          <div className="amz-browser-bar">
            <span className="amz-dot-btn red" />
            <span className="amz-dot-btn amber" />
            <span className="amz-dot-btn green" />
            <span className="amz-url">🔒 amazon.com/your-books?tabView=library</span>
          </div>
          <div className="amz-viewport">
            {['navigating', 'login', 'scraping'].includes(stage) && <div className="amz-scanline" />}

            {stage === 'login' && (
              <div className="amz-login-gate">
                <div className="amz-radar" />
                <p>Log in to Amazon in the Chromium window that just opened.</p>
                <p className="amz-muted">This can take a few minutes — scanning begins the moment your library renders. Keep this tab open to watch what gets found.</p>
              </div>
            )}

            {stream.length === 0 && stage !== 'login' && (
              <div className="amz-empty">
                {running ? 'Waiting for the first entries…' : 'Entries found on the Amazon page will stream in here.'}
              </div>
            )}

            <div className="amz-stream">
              {stream.map(row => {
                const meta = ACTION_META[row.action] || { label: 'Pending', cls: 'pending' };
                return (
                  <div key={row.id} className={`amz-card act-${meta.cls} ${row.enriching ? 'is-enriching' : ''}`}>
                    <div className="amz-card-cover">
                      {row.coverUrl
                        ? <img src={row.coverUrl} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                        : <span>📕</span>}
                      <span className="amz-card-idx">{row.id}</span>
                    </div>
                    <div className="amz-card-body">
                      <p className="amz-card-title">{trim(row.title, 90)}</p>
                      <p className="amz-card-sub">{row.amazonAsin ? `ASIN ${row.amazonAsin}` : 'no ASIN — matched by title and author'}</p>
                      <p className="amz-card-msg">{row.message}</p>
                    </div>
                    <span className={`amz-badge ${row.enriching ? 'enr' : meta.cls}`}>
                      {row.enriching ? 'Looking up…' : meta.label}
                    </span>
                  </div>
                );
              })}
              <div ref={streamEndRef} />
            </div>
          </div>
        </div>

        <div className="amz-log">
          {logs.length === 0
            ? <div className="amz-muted">Log output appears here.</div>
            : logs.map((line, i) => <div key={i} className="amz-log-line">{line}</div>)}
          <div ref={logEndRef} />
        </div>

        {summary && !running && (
          <div className="amz-summary">
            <h3>Run summary</h3>
            <p>
              {summary.found ?? 0} entries scanned → <strong>{summary.imported ?? 0}</strong> new book(s) added,{' '}
              <strong>{summary.duplicates ?? 0}</strong> already in your catalogue, <strong>{summary.skipped ?? 0}</strong> skipped
              {summary.asinLookedUp ? `, ${summary.asinLookedUp} ASIN(s) found by search` : ''}{summary.enriched ? `, ${summary.enriched} enriched with metadata` : ''}.
            </p>
            {summary.books?.length > 0 && (
              <ul className="amz-summary-list">
                {summary.books.map(book => (
                  <li key={book.id}>
                    <span className="amz-summary-title">{book.title}</span>
                    <span className="amz-muted">{book.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AmazonIntegration;



