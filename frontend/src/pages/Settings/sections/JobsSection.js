import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { jobsAPI } from '../../../services/api';
import { useSocket } from '../../../context/SocketContext';
import { Card, Badge } from '../ui';

const relative = (iso) => {
  if (!iso) return null;
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const fmt = abs < 60 ? `${Math.round(abs)}s` : abs < 3600 ? `${Math.round(abs / 60)} min` : abs < 86400 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86400)} d`;
  return diff < 0 ? `${fmt} ago` : `in ${fmt}`;
};
const duration = (ms) => (ms == null ? null : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`);

const JobsSection = () => {
  const socket = useSocket();
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState({});
  const [, setTick] = useState(0);

  const load = useCallback(() => jobsAPI.list().then(({ data }) => setJobs(data.jobs || [])).catch(() => toast.error('Failed to load jobs')), []);
  useEffect(() => { load(); }, [load]);

  // Live updates from the scheduler; re-render every 30s so relative times stay fresh
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    if (!socket) return () => clearInterval(t);
    const onStatus = (d) => setJobs(prev => prev.map(j => (j.id === d.job ? { ...j, ...(d.id ? d : {}), running: d.status === 'running' } : j)));
    socket.on('job:status', onStatus);
    return () => { clearInterval(t); socket.off('job:status', onStatus); };
  }, [socket]);

  const run = async (job) => {
    setBusy(b => ({ ...b, [job.id]: true }));
    setJobs(prev => prev.map(j => (j.id === job.id ? { ...j, running: true } : j)));
    try {
      const { data } = await jobsAPI.run(job.id);
      if (data.status === 'skipped') toast.info(`${job.name} is already running`);
      else toast.success(`${job.name}: ${data.message}`);
    } catch (e) {
      toast.error(`${job.name} failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(b => ({ ...b, [job.id]: false }));
      load();
    }
  };

  return (
    <Card title="Scheduled jobs" description="Jobs run on staggered schedules so they don't compete. Last run and result are kept across restarts.">
      <ul className="s-list">
        {jobs.map(job => {
          const running = busy[job.id] || job.running;
          return (
            <li key={job.id} className="s-list__item">
              <div className="s-list__row">
                <div className="s-list__main">
                  <span className="s-list__title">{job.name}</span>
                  <span className="s-list__meta">{job.description}</span>
                  <span className="s-list__meta">
                    ⏱ {job.scheduleText || job.schedule}
                    {job.nextRun && !job.manualOnly && <> · next <time dateTime={job.nextRun} title={new Date(job.nextRun).toLocaleString()}>{relative(job.nextRun)}</time></>}
                  </span>
                  <span className="s-list__meta">
                    {job.lastRun ? (
                      <>
                        Last run <time dateTime={job.lastRun} title={new Date(job.lastRun).toLocaleString()}>{relative(job.lastRun)}</time>
                        {job.lastDurationMs != null && ` (${duration(job.lastDurationMs)})`}
                        {job.lastStatus === 'error' ? <> — <span style={{ color: '#ff8a93' }}>failed: {job.lastError}</span></> : job.lastSummary ? ` — ${job.lastSummary}` : ''}
                      </>
                    ) : 'Not run yet'}
                  </span>
                </div>
                {running ? <Badge tone="info">Running</Badge>
                  : job.lastStatus === 'error' ? <Badge tone="off">Last run failed</Badge>
                  : job.lastRun ? <Badge tone="ok">OK</Badge> : null}
                <div className="s-list__actions">
                  <button type="button" className="s-btn s-btn--sm" onClick={() => run(job)} disabled={running} aria-label={`Run ${job.name} now`}>
                    {running ? 'Running…' : 'Run now'}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
        {jobs.length === 0 && <li className="s-empty">Loading…</li>}
      </ul>
    </Card>
  );
};

export default JobsSection;
