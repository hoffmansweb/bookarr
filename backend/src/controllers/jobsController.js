// Jobs API: list jobs with run history, and run any job now. Manual runs go through the
// scheduler too, so they're recorded and can't overlap a scheduled run.
const scheduler = require('../jobs/scheduler');

exports.list = (req, res) => {
  res.json({ jobs: scheduler.list(), serverTime: new Date().toISOString() });
};

const runJob = (id) => async (req, res) => {
  try {
    const result = await scheduler.runNow(id || req.params.id, { trigger: 'manual' });
    if (result.status === 'error') return res.status(500).json({ error: result.error });
    res.json({ message: result.summary || 'Done', status: result.status });
  } catch (error) {
    res.status(error.message.startsWith('Unknown job') ? 404 : 500).json({ error: error.message });
  }
};

exports.run = runJob();

// Legacy endpoints (kept for older frontends)
exports.runMonitoring = runJob('monitoring');
exports.runSearch = runJob('autoSearch');
exports.runDownloadCheck = runJob('downloadCheck');
exports.runLibrarySync = runJob('librarySync');
exports.runBooksRefresh = runJob('booksRefresh');
