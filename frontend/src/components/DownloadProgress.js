// Download progress bar for a book: live socket updates for in-app jobs (Anna's Archive,
// audiobook pipeline, TTS) and polling for download clients (qBittorrent, SABnzbd, ...).
import React, { useEffect, useRef, useState } from 'react';
import { bookAPI } from '../services/api';
import { useSocket } from '../context/SocketContext';
import './DownloadProgress.css';

const STAGE_LABELS = {
  queued: 'Queued',
  resolving: 'Finding download link',
  downloading: 'Downloading',
  converting: 'Converting to M4B',
  saving: 'Saving to library',
  importing: 'Importing',
  narrating: 'Narrating',
  done: 'Complete',
  failed: 'Failed'
};
const SOURCE_LABELS = { annas: "Anna's Archive", audiobook: 'Audiobook', tts: 'Text-to-speech' };

const formatBytes = (b) => {
  if (!b) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};
const formatEta = (s) => {
  if (s == null || s < 0) return null;
  if (s < 60) return `${Math.round(s)}s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

/**
 * @param {object} props.book       needs id, status, downloadName
 * @param {function} props.onStatusChange called with the fresh book when its status changes (e.g. import finished)
 */
const DownloadProgress = ({ book, onStatusChange }) => {
  const socket = useSocket();
  const [info, setInfo] = useState(null);
  const lastSocketAt = useRef(0);
  const statusRef = useRef(book.status);

  // In-app jobs: live events
  useEffect(() => {
    if (!socket) return undefined;
    const onProgress = (p) => {
      if (p.bookId !== book.id) return;
      lastSocketAt.current = Date.now();
      setInfo({
        inApp: true,
        source: p.source,
        stage: p.stage,
        percentage: p.percent ?? null,
        part: p.part,
        parts: p.parts,
        chapter: p.chapter,
        chapters: p.chapters,
        received: p.received,
        total: p.total,
        message: p.message,
        willRetry: p.willRetry
      });
    };
    socket.on('download:progress', onProgress);
    return () => socket.off('download:progress', onProgress);
  }, [socket, book.id]);

  // Download clients (and a snapshot for in-app jobs): poll while downloading
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      // Skip while live socket updates are flowing
      if (Date.now() - lastSocketAt.current > 8000) {
        try {
          const { data } = await bookAPI.getProgress(book.id);
          if (!cancelled && data) setInfo(prev => (data.inApp && prev?.inApp && Date.now() - lastSocketAt.current < 8000 ? prev : data));
        } catch (e) { /* transient */ }
      }
    };
    const checkStatus = async () => {
      try {
        const { data } = await bookAPI.getById(book.id);
        if (!cancelled && data?.status && data.status !== statusRef.current) {
          statusRef.current = data.status;
          onStatusChange?.(data);
        }
      } catch (e) { /* transient */ }
    };
    poll();
    const p = setInterval(poll, 3000);
    const s = setInterval(checkStatus, 10000);
    return () => { cancelled = true; clearInterval(p); clearInterval(s); };
  }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = info?.percentage != null && !Number.isNaN(Number(info.percentage)) ? Math.max(0, Math.min(100, Number(info.percentage))) : null;
  const failed = info?.stage === 'failed' && !info?.willRetry;

  // Headline: what's happening, from which source
  let label;
  if (info?.inApp) {
    label = STAGE_LABELS[info.stage] || 'Downloading';
    if (info.stage === 'downloading' && info.parts > 1) label += ` part ${info.part}/${info.parts}`;
    if (info.stage === 'narrating' && info.chapters) label += ` chapter ${info.chapter}/${info.chapters}`;
  } else if (info?.status === 'paused') {
    label = 'Paused';
  } else if (info?.status === 'seeding' || info?.status === 'completed') {
    label = 'Downloaded — waiting to import';
  } else {
    label = 'Downloading';
  }
  const source = info?.inApp
    ? SOURCE_LABELS[info.source] || (book.downloadName || '').split(':')[0]
    : info?.clientName || book.downloadName;

  const details = [
    pct != null && `${Math.round(pct)}%`,
    info?.received && info?.total ? `${formatBytes(info.received)} of ${formatBytes(info.total)}` : null,
    info?.speed ? `${formatBytes(info.speed)}/s` : null,
    formatEta(info?.etaSeconds) && `${formatEta(info.etaSeconds)} left`
  ].filter(Boolean);

  return (
    <div className={`dl-progress${failed ? ' is-failed' : ''}`}>
      <div className="dl-progress__head">
        <span className="dl-progress__label">{label}</span>
        {source && <span className="dl-progress__source">{source}</span>}
      </div>
      <div
        className={`dl-progress__track${pct == null ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-label={`Download progress for ${book.title}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-valuetext={pct != null ? `${Math.round(pct)}% — ${label}` : label}
      >
        <div className="dl-progress__fill" style={pct != null ? { width: `${pct}%` } : undefined} />
      </div>
      {(details.length > 0 || info?.message) && (
        <div className="dl-progress__meta">
          {details.join(' · ')}
          {info?.inApp && info?.message && info.stage !== 'downloading' && <span className="dl-progress__msg">{info.message}</span>}
        </div>
      )}
    </div>
  );
};

export default DownloadProgress;
