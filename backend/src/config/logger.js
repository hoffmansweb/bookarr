const winston = require('winston');
const util = require('util');
const path = require('path');

// Production (Docker) keeps logs in the data volume so they survive container updates
const LOG_DIR = process.env.LOG_DIR ||
  (process.env.NODE_ENV === 'production' ? '/app/data/logs' : path.join(__dirname, '..', '..', 'logs'));

const SPLAT = Symbol.for('splat');

// Some errors (e.g. Node's AggregateError from dual-stack connect failures,
// which axios surfaces) have an empty .message. Fall back to code / nested errors.
const describeError = (err) => {
  if (!err) return '';
  if (typeof err !== 'object') return String(err);
  if (err.message) return err.message;
  if (Array.isArray(err.errors) && err.errors.length) {
    const nested = err.errors.map(e => (e && (e.message || e.code)) || String(e)).filter(Boolean);
    if (nested.length) return `${err.code ? err.code + ': ' : ''}${nested.join('; ')}`;
  }
  if (err.code) return String(err.code);
  return err.name || 'Unknown error';
};

// winston 3 silently drops extra string/number args passed as
// logger.error('msg:', value) unless a splat-aware format is used.
// Append them to the message, rendering Error objects as message (+stack).
const appendSplat = winston.format((info) => {
  const splat = info[SPLAT];
  if (!Array.isArray(splat) || splat.length === 0) return info;

  const extras = [];
  splat.forEach((arg, idx) => {
    if (arg instanceof Error) {
      const msg = describeError(arg);
      // winston already appends meta.message for the first object argument
      if (idx === 0 && arg.message && String(info.message).endsWith(arg.message)) {
        if (!info.stack && arg.stack) info.stack = arg.stack;
        return;
      }
      extras.push(msg);
      if (!info.stack && arg.stack) info.stack = arg.stack;
    } else if (arg !== null && typeof arg === 'object') {
      if (idx === 0 && arg.message && String(info.message).endsWith(String(arg.message))) return;
      extras.push(util.inspect(arg, { depth: 2, breakLength: Infinity }));
    } else if (arg !== undefined) {
      extras.push(String(arg));
    }
  });

  if (extras.length) info.message = [info.message, ...extras].join(' ');
  return info;
});

// Top-level Error passed directly: logger.error(err)
const normalizeError = winston.format((info) => {
  if (info instanceof Error || (info.message === '' && info.stack)) {
    info.message = describeError(info) || info.message;
  }
  return info;
});

// Message already carries the error text (winston appends meta.message, and
// format.errors sets it for logger.error(err)); only append the stack frames.
const render = (info, upper) => {
  const lvl = upper ? String(info.level).toUpperCase() : info.level;
  let body = String(info.message);
  if (info.stack) {
    const frames = String(info.stack).split('\n').filter(l => /^\s+at /.test(l));
    if (frames.length) body += '\n' + frames.join('\n');
  }
  return `${info.timestamp} [${lvl}]: ${body}`;
};

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    normalizeError(),
    appendSplat(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(info => render(info, true))
  ),
  transports: [
    new winston.transports.File({ filename: path.join(LOG_DIR, 'error.log'), level: 'error', maxsize: 10 * 1024 * 1024, maxFiles: 3 }),
    new winston.transports.File({ filename: path.join(LOG_DIR, 'combined.log'), maxsize: 20 * 1024 * 1024, maxFiles: 3 })
  ]
});

// Always log to the console too: in Docker that's what `docker logs` shows
const isProd = process.env.NODE_ENV === 'production';
logger.add(new winston.transports.Console({
  format: winston.format.combine(
    winston.format.timestamp({ format: isProd ? 'YYYY-MM-DD HH:mm:ss' : 'HH:mm:ss' }),
    ...(isProd ? [] : [winston.format.colorize()]),
    winston.format.printf(info => render(info, false))
  )
}));

logger.describeError = describeError;
logger.LOG_DIR = LOG_DIR;

module.exports = logger;
