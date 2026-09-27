// Central job scheduler: every recurring job registers here so we get one place that
// (a) never runs the same job twice at once, (b) records last run / duration / result,
// persisted across restarts in the `job_state` setting, (c) reports next run times, and
// (d) broadcasts `job:status` so the Settings → Jobs page updates live.
const cron = require('node-cron');
const logger = require('../config/logger');

const jobs = new Map();
let io = null;
let persisted = {};

const setIO = (socketIo) => { io = socketIo; };
const emitStatus = (job) => { if (io) io.emit('job:status', { job: job.id, status: job.running ? 'running' : 'idle', ...publicState(job) }); };

// --- minimal cron "next run" calculator (5 fields: min hour dom month dow) ---
const parseField = (field, min, max) => {
  const values = new Set();
  for (const part of field.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    let [lo, hi] = range === '*' ? [min, max] : range.split('-').map(n => parseInt(n, 10));
    if (hi === undefined) hi = stepStr ? max : lo;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
};
const nextRun = (expr, from = new Date()) => {
  try {
    const [m, h, dom, mon, dow] = expr.trim().split(/\s+/);
    const sets = [parseField(m, 0, 59), parseField(h, 0, 23), parseField(dom, 1, 31), parseField(mon, 1, 12), parseField(dow, 0, 7)];
    const d = new Date(from);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < 60 * 24 * 32; i++) {
      const dayOk = sets[2].has(d.getDate()) && sets[3].has(d.getMonth() + 1) && (sets[4].has(d.getDay()) || (d.getDay() === 0 && sets[4].has(7)));
      if (dayOk && sets[1].has(d.getHours()) && sets[0].has(d.getMinutes())) return d.toISOString();
      d.setMinutes(d.getMinutes() + 1);
    }
  } catch (e) { /* unparseable expression */ }
  return null;
};

const publicState = (job) => ({
  id: job.id,
  name: job.name,
  description: job.description,
  schedule: job.schedule,
  scheduleText: job.scheduleText,
  running: job.running,
  lastRun: job.lastRun,
  lastDurationMs: job.lastDurationMs,
  lastStatus: job.lastStatus,        // 'ok' | 'error' | 'skipped'
  lastSummary: job.lastSummary,
  lastError: job.lastError,
  runCount: job.runCount,
  nextRun: job.enabled === false ? null : nextRun(job.schedule),
  manualOnly: !!job.manualOnly
});

const persist = async () => {
  try {
    const { Setting } = require('../models');
    const state = {};
    for (const job of jobs.values()) {
      state[job.id] = { lastRun: job.lastRun, lastDurationMs: job.lastDurationMs, lastStatus: job.lastStatus, lastSummary: job.lastSummary, lastError: job.lastError, runCount: job.runCount };
    }
    await Setting.upsert({ key: 'job_state', value: JSON.stringify(state) });
  } catch (e) { /* non-critical */ }
};

/**
 * Register a job.
 * @param {object} def { id, name, description, schedule (cron), scheduleText, run: async () => summary string|object|undefined,
 *                       quiet: true to skip history for no-op runs (run returns null), manualOnly }
 */
const register = (def) => {
  // A job whose definition has no run() cannot be scheduled. Refuse it here so a typo (a job once
  // went in as `handler:` instead of `run:`) shows up once, loudly, at start-up - instead of once
  // per minute in the log as "job.run is not a function".
  if (typeof def.run !== 'function') {
    logger.error(`Job "${def.name || def.id}" was not registered: run must be a function (got ${typeof def.run})`);
    return;
  }
  const saved = persisted[def.id] || {};
  jobs.set(def.id, { ...def, running: false, runCount: 0, ...saved });
};

/**
 * Run a job now (scheduled or manual). Skips if it's already running.
 * @returns {Promise<{status, summary?, error?}>}
 */
const runNow = async (id, { trigger = 'manual' } = {}) => {
  const job = jobs.get(id);
  if (!job) throw new Error(`Unknown job: ${id}`);
  if (job.running) {
    logger.info(`Job "${job.name}" is still running; skipping this ${trigger} run`);
    return { status: 'skipped', summary: 'Already running' };
  }
  job.running = true;
  if (!job.quiet) emitStatus(job);
  const started = Date.now();
  let noop = false;
  try {
    const result = await job.run();
    // Quiet jobs (e.g. download check with nothing downloading) return null: don't record a run
    if (result === null && job.quiet) {
      noop = true;
      return { status: 'ok', summary: null };
    }
    job.lastSummary = typeof result === 'string' ? result : (result?.summary || 'Completed');
    job.lastStatus = 'ok';
    job.lastError = null;
    if (trigger !== 'minutely') logger.info(`Job "${job.name}" finished in ${((Date.now() - started) / 1000).toFixed(1)}s: ${job.lastSummary}`);
    return { status: 'ok', summary: job.lastSummary };
  } catch (error) {
    job.lastStatus = 'error';
    job.lastError = error.message;
    job.lastSummary = null;
    logger.error(`Job "${job.name}" failed: ${error.message}`);
    return { status: 'error', error: error.message };
  } finally {
    job.running = false;
    if (!noop) {
      job.lastRun = new Date(started).toISOString();
      job.lastDurationMs = Date.now() - started;
      job.runCount = (job.runCount || 0) + 1;
      emitStatus(job);
      persist();
    }
  }
};

/** Load saved run history, then schedule every registered job. */
const start = async () => {
  try {
    const { Setting } = require('../models');
    const row = await Setting.findOne({ where: { key: 'job_state' } });
    persisted = row?.value ? JSON.parse(row.value) : {};
    for (const job of jobs.values()) Object.assign(job, persisted[job.id] || {}, { running: false });
  } catch (e) { persisted = {}; }

  for (const job of jobs.values()) {
    if (job.manualOnly) continue;
    if (!cron.validate(job.schedule)) {
      logger.error(`Job "${job.name}" has an invalid schedule "${job.schedule}" — not scheduled`);
      continue;
    }
    cron.schedule(job.schedule, () => { runNow(job.id, { trigger: job.quiet ? 'minutely' : 'scheduled' }).catch(() => {}); });
    logger.info(`Scheduled "${job.name}": ${job.scheduleText || job.schedule} (next ${new Date(nextRun(job.schedule)).toLocaleString()})`);
  }
};

const list = () => [...jobs.values()].map(publicState);

module.exports = { register, start, runNow, list, setIO, nextRun };
