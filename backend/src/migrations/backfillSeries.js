// One-off backfill: books added before the scrapers returned series data keep an empty
// `series` column, so look each one up on Goodreads and fill `series`/`seriesPosition`.
// Safe to re-run — it only considers books whose series is still empty.
//
//   node src/migrations/backfillSeries.js [--limit=50] [--dry-run]
const { Op } = require('sequelize');
const { Book } = require('../models');
const goodreads = require('../scrapers/goodreads');
const browserPool = require('../scrapers/browserPool');
const { parseSeriesText } = require('../utils/series');

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit === `--${name}`) return true;
  const value = hit.split('=')[1];
  return Number.isNaN(Number(value)) ? value : Number(value);
};

const DELAY_MS = 2000; // same politeness delay as the author-refresh enrichment

async function migrate() {
  const limit = Number(arg('limit', 0)) || undefined; // absent/0 = every candidate
  const dryRun = Boolean(arg('dry-run', false));

  // Pass 1 — free: rows written before the scrapers split the number out keep it in the
  // name ("Society of Villains #1"), so normalise those locally, no scraping involved.
  const unsplit = await Book.findAll({
    attributes: ['id', 'title', 'series', 'seriesPosition'],
    where: { series: { [Op.ne]: null }, seriesPosition: null }
  });
  let normalised = 0;
  for (const book of unsplit) {
    const parsed = parseSeriesText(book.series);
    if (!parsed.series || (parsed.series === book.series && !parsed.seriesPosition)) continue;
    normalised++;
    console.log(`[split] ${book.title}: "${book.series}" -> ${parsed.series}${parsed.seriesPosition ? ` (Book ${parsed.seriesPosition})` : ''}`);
    if (!dryRun) await book.update({ series: parsed.series, seriesPosition: parsed.seriesPosition });
  }
  console.log(`${normalised} existing series name(s) split into name + position`);

  // Pass 2 — scrape the books that have no series at all
  const candidates = await Book.findAll({
    // Only the columns this script needs: the Books table has drifted from the model
    // before (a restored backup), and selecting everything would fail on a missing column.
    attributes: ['id', 'title', 'goodreadsId'],
    where: {
      goodreadsId: { [Op.ne]: null },
      [Op.or]: [{ series: null }, { series: '' }]
    },
    order: [['createdAt', 'DESC']],
    ...(limit ? { limit } : {})
  });

  console.log(`${candidates.length} book(s) with a Goodreads id but no series${dryRun ? ' (dry run: nothing is written)' : ''}`);

  const stats = { filled: 0, none: 0, failed: 0 };
  for (let i = 0; i < candidates.length; i++) {
    const book = candidates[i];
    const label = `[${i + 1}/${candidates.length}] ${book.title}`;
    try {
      const details = await goodreads.getBookDetails(book.goodreadsId);
      if (details?.series) {
        stats.filled++;
        console.log(`${label} -> ${details.series}${details.seriesPosition ? ` (Book ${details.seriesPosition})` : ''}`);
        if (!dryRun) await book.update({ series: details.series, seriesPosition: details.seriesPosition ?? null });
      } else {
        stats.none++;
        console.log(`${label} -> no series listed on the Goodreads page`);
      }
    } catch (error) {
      stats.failed++;
      console.log(`${label} -> failed: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }

  console.log(`Backfill complete: ${stats.filled} filled, ${stats.none} without a series, ${stats.failed} failed`);
}

const shutdown = async (code) => {
  await browserPool.closeBrowser().catch(() => {});
  process.exit(code);
};

migrate()
  .then(() => shutdown(0))
  .catch(async (error) => {
    console.error('Backfill failed:', error);
    await shutdown(1);
  });
