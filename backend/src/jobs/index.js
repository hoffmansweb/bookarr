// Every recurring job, registered with the central scheduler.
// Schedules are staggered so jobs don't all fire in the same minute (they used to all
// run at :00, racing each other and overloading the shared headless browser).
const scheduler = require('./scheduler');
const logger = require('../config/logger');

// Env overrides for schedules. The old defaults ("0 */6 * * *", "0 */2 * * *") are still in many .env
// files copied from .env.example; treat those as "use the staggered default" so jobs don't all fire at :00.
const scheduleFromEnv = (value, legacyDefault) => {
  const v = String(value || '').trim();
  return v && v !== legacyDefault ? v : null;
};
const MONITOR_SCHEDULE = scheduleFromEnv(process.env.MONITOR_CHECK_INTERVAL, '0 */6 * * *');
const SEARCH_SCHEDULE = scheduleFromEnv(process.env.SEARCH_INTERVAL, '0 */2 * * *');

const registerJobs = () => {
  const searchJob = require('./search');
  const monitoringJob = require('./monitoring');
  const { checkDownloads, checkStalledDownloads } = require('./downloadCheck');
  const { refreshBooksMetadata } = require('./booksRefresh');
  const { syncLibrary } = require('./librarySync');
  const { housekeeping, backupDatabase } = require('./maintenance');
  const ttsQueueMonitor = require('./ttsQueueMonitor');

  scheduler.register({
    id: 'ttsQueueMonitor',
    name: 'TTS Queue Monitor',
    description: 'Resumes pending Audiobook creation jobs if the server restarted.',
    schedule: '* * * * *',
    scheduleText: 'Every minute',
    quiet: true,
    run: ttsQueueMonitor.run
  });

  scheduler.register({
    id: 'downloadCheck',
    name: 'Download check',
    description: 'Imports finished downloads from your download clients into the library.',
    schedule: '* * * * *',
    scheduleText: 'Every minute while something is downloading',
    quiet: true, // runs with nothing to do aren't recorded
    run: checkDownloads
  });

  scheduler.register({
    id: 'monitoring',
    name: 'Author monitoring',
    description: 'Checks monitored authors for new releases.',
    schedule: MONITOR_SCHEDULE || '5 */6 * * *',
    scheduleText: MONITOR_SCHEDULE ? undefined : 'Every 6 hours (at :05)',
    run: async () => {
      const result = await monitoringJob.checkMonitoredAuthors();
      // New wanted books: search for them now instead of waiting for the next auto-search
      if (result?.found > 0 && result.status === 'wanted') {
        logger.info(`Monitoring added ${result.found} wanted book(s); starting auto-search`);
        setTimeout(() => scheduler.runNow('autoSearch', { trigger: 'after monitoring' }).catch(() => {}), 5000);
      }
      return result;
    }
  });
  const goodreadsSync = require('./goodreadsSync');
  scheduler.register({
    id: 'goodreadsSync',
    name: 'Goodreads Auto-Sync',
    description: 'Imports "Want to Read" books from your Goodreads RSS feed.',
    schedule: '42 */3 * * *',
    scheduleText: 'Every 3 hours',
    run: goodreadsSync
  });
  const prowlarrSync = require('./prowlarrSync');
  scheduler.register({
    id: 'prowlarrSync',
    name: 'Prowlarr Indexer Sync',
    description: 'Automatically pulls your configured indexers from Prowlarr.',
    schedule: '14 */6 * * *',
    scheduleText: 'Every 6 hours',
    run: prowlarrSync
  });



  scheduler.register({
    id: 'autoSearch',
    name: 'Auto search',
    description: 'Searches wanted books using your download priority (least recently searched first). Batch size: auto_search_batch setting.',
    schedule: SEARCH_SCHEDULE || '20 */2 * * *',
    scheduleText: SEARCH_SCHEDULE ? undefined : 'Every 2 hours (at :20), and after monitoring finds new books',
    run: () => searchJob.searchWantedBooks()
  });

  scheduler.register({
    id: 'stalledDownloads',
    name: 'Stalled download watchdog',
    description: 'Downloads that never finish (download_stall_hours, default 48) are retried with a different release.',
    schedule: '10 * * * *',
    scheduleText: 'Hourly (at :10)',
    run: checkStalledDownloads
  });

  scheduler.register({
    id: 'booksRefresh',
    name: 'Metadata refresh',
    description: 'Fills in missing descriptions, covers, ISBNs and ratings (each book at most weekly).',
    schedule: '40 */2 * * *',
    scheduleText: 'Every 2 hours (at :40)',
    run: refreshBooksMetadata
  });

  scheduler.register({
    id: 'librarySync',
    name: 'Library sync',
    description: 'Matches files in your library folders to books.',
    schedule: '50 */4 * * *',
    scheduleText: 'Every 4 hours (at :50)',
    run: () => syncLibrary()
  });

  scheduler.register({
    id: 'libraryScan',
    name: 'Library import',
    description: "Adds books found in your library folders that Bookarr doesn't know about yet.",
    schedule: '0 0 1 1 *',
    scheduleText: 'Manual',
    manualOnly: true,
    run: async () => {
      // Reuse the HTTP handler; it responds via res.json
      const { scanLibrary } = require('../controllers/libraryController');
      let payload = null;
      const res = { json: (d) => { payload = d; }, status() { return this; } };
      await scanLibrary({ app: { get: () => null } }, res);
      return payload?.message || 'Library import finished';
    }
  });

  scheduler.register({
    id: 'indexerSync',
    name: 'Indexer refresh',
    description: 'Refreshes URLs, API keys and categories of indexers imported from Prowlarr / Jackett.',
    schedule: '17 4 * * *',
    scheduleText: 'Daily at 04:17',
    run: () => require('../services/indexerSync').refreshSavedConnections()
  });

  scheduler.register({
    id: 'ytdlpUpdate',
    name: 'yt-dlp update',
    description: 'Keeps yt-dlp current; YouTube regularly breaks older versions.',
    schedule: '30 3 * * *',
    scheduleText: 'Daily at 03:30 (and shortly after start-up)',
    run: async () => ((await require('../utils/ytdlp').update({ force: true })) ? 'yt-dlp checked/updated (version in log)' : 'Update failed — see log')
  });

  scheduler.register({
    id: 'backup',
    name: 'Database backup',
    description: 'Nightly snapshot of the database into the backups folder next to it (keeps db_backup_keep, default 7).',
    schedule: '0 3 * * *',
    scheduleText: 'Daily at 03:00',
    run: backupDatabase
  });

  scheduler.register({
    id: 'housekeeping',
    name: 'Housekeeping',
    description: 'Removes leftover temp files from interrupted downloads and prunes old notifications.',
    schedule: '45 3 * * *',
    scheduleText: 'Daily at 03:45',
    run: housekeeping
  });
};

const startJobs = async () => {
  registerJobs();
  await scheduler.start();
  // One-off after boot: make sure yt-dlp is current before the first YouTube download
  setTimeout(() => scheduler.runNow('ytdlpUpdate', { trigger: 'startup' }).catch(() => {}), 60 * 1000).unref();
};

module.exports = { startJobs, scheduler };
