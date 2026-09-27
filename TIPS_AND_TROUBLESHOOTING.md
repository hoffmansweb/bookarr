# Bookarr - Tips, Tricks & Troubleshooting

## 🎯 Pro Tips

### Getting the Most Out of Bookarr

1. **Get a Google Books API Key**
   - Free tier: 1,000 requests/day
   - Significantly improves search results
   - Better book metadata
   - Get it at: https://console.cloud.google.com/

2. **Optimize Monitoring Schedule**
   ```bash
   # Check more frequently for active authors
   MONITOR_CHECK_INTERVAL=0 */3 * * *  # Every 3 hours
   
   # Check less frequently to save resources
   MONITOR_CHECK_INTERVAL=0 0 */12 * *  # Twice daily
   
   # Check only at night
   MONITOR_CHECK_INTERVAL=0 2 * * *  # 2 AM daily
   ```

3. **Use Multiple Search Terms**
   - Try author name + book title
   - Use ISBN for exact matches
   - Try different spellings
   - Search by series name

4. **Monitor Prolific Authors Carefully**
   - Authors who publish frequently will generate many notifications
   - Consider monitoring only your favorite prolific authors
   - Use the "Ignore" status for books you don't want

5. **Organize Your Library**
   - Use status tracking: Wanted → Available → Reading → Completed
   - Add books to library as you acquire them
   - Update status as you read
   - Use filters to find books quickly

### Mobile & Phone Use

The user-facing pages (Dashboard, Books, Authors, Library, Calendar, Activity and the reader)
are built phone-first; the admin Settings/System pages are still desktop-oriented.

- On a phone the navbar collapses its links behind the **☰** button. The drawer closes on a
  link tap, on **Esc**, or on a tap outside it.
- The layout uses `env(safe-area-inset-*)` together with `viewport-fit=cover`
  (`frontend/public/index.html`), so the fixed navbar, the modals and the full-screen reader
  clear the notch and the home indicator.
- Inputs render at 16px on small screens (`App.css`). iOS Safari zooms the page whenever a
  focused field is smaller than that, which used to leave the layout scrolled sideways.
- Controls get a 44px minimum hit area, and `@media (hover: none)` rules drop the `:hover`
  lift/glow that otherwise sticks to whatever you last tapped.
- The reader is full-bleed on phones (`100dvh`), its table of contents becomes a bottom sheet,
  and the Activity history table stacks into cards with the column names as labels.

## 🔧 Configuration Tips

### Backend Configuration

**Database Performance**
```javascript
// In backend/src/config/database.js
pool: {
  max: 10,        // Increase for more concurrent connections
  min: 2,         // Keep some connections ready
  acquire: 30000,
  idle: 10000
}
```

**Scraper Settings**
```bash
# Adjust in backend/.env
SCRAPER_DELAY=3000        # Increase if getting blocked
SCRAPER_MAX_RETRIES=5     # More retries for reliability
```

**Logging Levels**
```bash
# In backend/.env
NODE_ENV=production  # Less verbose logging
NODE_ENV=development # Detailed logging
```

### Frontend Configuration

**API Timeout**
```javascript
// In frontend/src/services/api.js
const api = axios.create({
  baseURL: API_URL,
  timeout: 10000  // Increase for slow connections
});
```

**Notification Settings**
```javascript
// In frontend/src/App.js
<ToastContainer 
  position="bottom-right" 
  autoClose={5000}  // Adjust notification duration
  hideProgressBar={false}
/>
```

## 🐛 Troubleshooting Guide

### Backend Issues

#### Problem: Backend won't start
```bash
# Check if port 5000 is available
netstat -ano | findstr :5000

# Check logs
type backend\logs\error.log
```

**Solution:**
- Check if port 5000 is already in use
- Check `backend/.env` exists; `JWT_SECRET` may be left blank — Bookarr generates one into
  `backend/.jwt_secret` on first start
- The database is a SQLite file at `backend/database.sqlite` — make sure that folder is writable
- Review error logs

#### Problem: Database errors (locked, missing, empty library)
```bash
# SQLite keeps everything in one file; is it there and non-zero?
dir backend\database.sqlite

# Docker: the same file lives in the data volume
docker compose exec bookarr ls -l /app/data
```

**Solution:**
- There is no database server to start or create — SQLite is bundled
- If the file is missing, Bookarr recreates it empty on the next start; copy a snapshot back
  from `backend/backups/` (Docker: `/app/data/backups`) to recover your data
- "Database is locked" means two instances are using the same file: stop the duplicate
  (e.g. a native install and the Docker container pointing at the same volume)

#### Problem: JWT authentication errors
**Solution:**
- `JWT_SECRET` may be blank: the signing key lives in `backend/.jwt_secret` (Docker:
  `/app/data/.jwt_secret`) and is generated on first start. Deleting that file, or changing
  `JWT_SECRET` to a different value, signs everybody out — log in again to get a fresh token
- Placeholder values such as `<your-secure-random-secret-here>` are ignored on purpose (a published
  key would let anyone forge a token); a real key is generated instead
- Ensure token is being sent in headers
- Verify token hasn't expired
- Clear localStorage and login again

#### Problem: Monitoring job not running
**Solution:**
```bash
# Check cron expression is valid
# Use: https://crontab.guru/

# Verify in logs
type backend\logs\combined.log | findstr "monitoring"

# Test manually by restarting server
# Job runs on startup
```

#### Problem: External API errors
**Solution:**
- Check internet connection
- Verify API keys are correct
- Check API rate limits
- Review error logs for specific API
- Try again later (APIs may be down)

### Frontend Issues

#### Problem: Frontend won't start
```bash
# Clear node_modules and reinstall
rmdir /s /q node_modules
npm install --legacy-peer-deps

# Clear cache
npm cache clean --force
```

**Solution:**
- Delete `node_modules` and reinstall
- Check Node.js version (v16+)
- Verify backend is running
- Check for port conflicts

#### Problem: Can't connect to backend
**Solution:**
- Verify backend is running on port 5000
- Check `.env` has correct `REACT_APP_API_URL`
- Check browser console for CORS errors
- Verify network requests in DevTools

#### Problem: Login/Register not working
**Solution:**
- Check backend is running
- Open browser DevTools → Network tab
- Look for failed requests
- Check backend logs for errors
- Verify database is accessible

#### Problem: Search returns no results
**Solution:**
- Add Google Books API key
- Check internet connection
- Try different search terms
- Check backend logs for API errors
- Verify external APIs are accessible

#### Problem: Notifications not appearing
**Solution:**
- Check Socket.io connection in DevTools
- Verify backend Socket.io is running
- Check browser console for errors
- Ensure user is logged in
- Try refreshing the page

### Database Issues

#### Problem: Database tables not created
```bash
# Backend auto-creates tables on startup
# Check logs for migration errors
type backend\logs\combined.log | findstr "sync"
```

**Solution:**
```javascript
// In backend/src/server.js
// Change to force recreate (WARNING: deletes data)
await sequelize.sync({ force: true });

// Or use alter to update schema
await sequelize.sync({ alter: true });
// WARNING: never use { alter: true } on a model with a composite primary key (e.g. the UserBooks
// join table). SQLite's alter reads the primary key's autoindex, treats each key column as
// individually UNIQUE and rewrites the table with those extra constraints - silently while the
// table holds 0-1 rows, and with UNIQUE constraint failures once it holds more. See
// "progress never saves" below.
```

#### Note: added columns run on boot (`Books.importedAt`)

`Books` has no separate "downloaded" timestamp: `createdAt` is when the *row* appeared (the
"wanted" date for a book that was searched for first) and `updatedAt` moves on every metadata
refresh, chapter extraction or status change — in one real library 50 of 54 imported books had
`updatedAt` more than an hour after `createdAt`. `importedAt` is written once by the import
paths (download import, ebook/audiobook pipelines, LibriVox, Internet Archive, TTS, library
scan/sync) and never moved afterwards, even if the same book is imported again.

`server.js` adds the column on boot (`src/migrations/addImportedAt.js`) and then backfills rows
that already have a `filePath`, using `updatedAt` as an estimate — so the arrival date of books
imported before the column existed can be a few hours late. To prefer the import date instead:

```sql
UPDATE Books SET importedAt = createdAt WHERE filePath IS NOT NULL;
```

The Dashboard's "New Arrivals" row (`GET /api/books/recent-arrivals`) and the "Added" line in
the book details modal read it.

#### Problem: Duplicate books/authors
**Solution:**
- Deduplication should handle this automatically
- Check ISBN fields are populated
- Manually delete duplicates via API
- Review aggregator service logic

#### Problem: Database is slow
**Solution:**
```sql
-- Add indexes for common queries
CREATE INDEX idx_books_isbn13 ON "Books"(isbn13);
CREATE INDEX idx_books_status ON "Books"(status);
CREATE INDEX idx_authors_monitored ON "Authors"(monitored);
CREATE INDEX idx_notifications_user_read ON "Notifications"(userId, read);
```

#### Problem: Library files are gone, but the database still lists them
Symptoms: every book 404s when opened, the reader shows "This file is missing"
(`/api/books/:id/file-status` reports `FILE_MISSING` or `NO_MP3_IN_FOLDER`), and the
library still shows covers and badges for files that no longer exist.

**Solution:**
```bash
cd backend

# 1. Report only - shows what is in the database and what a clean-up would remove
node clearBookData.js

# 2. Delete the library rows, keeping users, settings, indexers and download clients
node clearBookData.js --yes
```

Other scopes (combine as needed):
```bash
node clearBookData.js --yes --keep-wanted       # keep status=wanted (your download queue)
node clearBookData.js --yes --file-backed-only  # only delete books that have a filePath
node clearBookData.js --yes --authors --notifications  # also drop authors + book notifications
node clearBookData.js --yes --vacuum            # shrink the database file afterwards
```

A snapshot is written to `backend/backups/database-before-book-cleanup-<timestamp>.sqlite`
before anything is deleted. To roll back, stop the backend and copy that file over
`backend/database.sqlite`. After cleaning up, point `ebooks_folder` /
`audiobooks_folder` in Settings at the real location and run a library scan to
rebuild the library.

#### Problem: progress never saves — `POST /api/books/:id/reading-progress` 500s for every book except the first

Symptoms: the reader works, but only the first book ever remembers its position. For every other
book the browser console shows this every 10 seconds, forever:

```
Reader.js:241  POST http://localhost:5000/api/books/<id>/reading-progress 500 (Internal Server Error)
```

The response body is only `{"error":"Validation error"}`, the backend log says nothing (the route
answers with `error.message`, and Sequelize's unique-constraint error is just "Validation error"),
and reopening the book starts at the wrong place because nothing was stored.

Cause: the `UserBooks` join table (each user's library / progress rows) had picked up a **UNIQUE
constraint on `UserId` and on `BookId` separately**, on top of its composite primary key. That
permits exactly one row per user *and* one row per book, so a second book can never be inserted.
The author of those constraints is the `UserBooks.sync({ alter: true })` call that used to run on
every boot: Sequelize's SQLite `alter` reads `PRAGMA INDEX_LIST`, finds the composite primary
key's autoindex, concludes that each key column is individually unique, and rebuilds the table
that way. With 0-1 rows the copy succeeds silently — which is why the broken schema survived every
restart — and once a user has 2+ books the same rebuild fails with
`UNIQUE constraint failed: UserBooks_backup.UserId` and leaves an empty `UserBooks_backup` behind.

Check the table:

```sh
cd backend
node -e "const s=require('sqlite3');const db=new s.Database('database.sqlite',s.OPEN_READONLY);db.get(\"SELECT sql FROM sqlite_master WHERE name='UserBooks'\",(e,r)=>{console.log(e?e.message:r.sql);db.close()})"
```

You have the bug if `UserId`/`BookId` are each followed by `UNIQUE`. Healthy looks like
`... PRIMARY KEY (`UserId`, `BookId`))` with no `UNIQUE` on the columns, and multiple rows for one
user are correct:

```sql
SELECT UserId, COUNT(*) FROM UserBooks GROUP BY UserId;   -- 2+ rows per user is expected
```

**Fix:** `backend/src/migrations/fixUserBooksUniqueConstraints.js` rebuilds the table with only the
composite primary key, copies every row, drops a leftover empty `UserBooks_backup`, and runs on
every start (idempotent, no-op once the table is clean). `server.js` now calls plain
`UserBooks.sync()` for this table — never `alter`. To repair a running instance without restarting
it:

```sh
cd backend
node -e "require('dotenv').config();require('./src/migrations/fixUserBooksUniqueConstraints')().then(r=>{console.log('changed:',r);process.exit(0)})"
```

Copy `database.sqlite` to `backend/backups/` first — the migration rewrites the table (it keeps
every row, but a backup makes rollbacks trivial).

#### Problem: restoring a backup answers `400 Bad Request`

The interface (Settings → System → Backup & Restore → *Restore backup*) now prints the reason under the
two buttons instead of only toasting it, and the same sentence goes to the log:

```bash
docker compose logs --tail=100 bookarr | findstr /i "restore"   # Windows
docker compose logs --tail=100 bookarr | grep -i restore        # Linux / macOS
```

Posting the file yourself shows the exact reason too:

```bash
curl -H "Authorization: Bearer <token>" -F "dbFile=@bookarr-backup-2026-09-27.zip" \
  http://192.168.1.75:5057/api/system/backup/restore
```

| Message | What it means | What to do |
| --- | --- | --- |
| `No backup file arrived: the request body was sent as "application/json"` | the file was not posted as a form. The card hit this itself while the API client asked for `application/json` up front: axios serialised the FormData body into `{"dbFile":{}}`, so the upload left the browser with the file already gone | reload the page (an old cached interface did this) and retry, or `curl -F dbFile=@…` |
| `No backup file arrived: … multipart/form-data with no boundary` | the client set `Content-Type: multipart/form-data` itself, so the boundary that marks where the file starts was missing and the upload was dropped | reload the page (an old cached interface did this) and retry |
| `"file" arrived empty (0 bytes)` | the download or the copy never finished | download the backup again |
| `That file is neither a SQLite database nor a readable .zip archive` | not a Bookarr backup — `.gz`, `.tar`, `.sql`, `.7z` and folders of books cannot be read here | upload the `.zip` Bookarr wrote, or a `database.sqlite` |
| `The archive contains no .sqlite database` | a zip, but nothing database-shaped inside | check you picked the Bookarr backup, not a zip of the library |
| `The database inside this archive does not match the checksum its own metadata.json recorded` | the database was edited, re-packed or damaged after the backup was written | unzip it and upload the `database.sqlite` inside — a raw `.sqlite` is checked on its own and skips this comparison |
| `This file is not a Bookarr database: it has no Users table` | a valid SQLite file, but from something else (restoring it would leave Bookarr with no accounts) | pick the Bookarr database |
| `That file is larger than the 8 GB a single upload accepts` (HTTP 413) | the upload hit the cap | restore next to the container, or copy `database.sqlite` into the volume by hand |

Two things worth knowing:

- An **older Bookarr database is accepted even without a `Books` or `Settings` table**: Bookarr
  recreates those empty at the next start-up and says so in the response (`warnings`) — check the
  library after restarting. `Users` is the only table a restore insists on, because otherwise the
  install would have no accounts left.
- A restore replaces `database.sqlite` in place, keeps the previous one as
  `/app/data/backups/database-before-restore-<timestamp>.sqlite`, restores `.env` / `.jwt_secret` when
  the archive carries them (the files they replace are renamed `*.backup-<timestamp>`), and signs
  everybody out. Restart the container to load a restored `.env` or session secret.


#### Problem: the Updates tab says `Could not fetch update data` and the browser console shows a 404 from `api.github.com`

That 404 is not an outage. GitHub answers
`https://api.github.com/repos/hoffmansweb/bookarr/releases/latest` from **published** releases only, and
the repository's release workflow (Release Drafter) leaves every release as a **draft** until a person
publishes it. With drafts only, that endpoint answers 404 — the same answer a private or renamed
repository gives, which is why the interface could only say "Could not fetch update data".

The interface no longer calls GitHub from the browser. It asks the backend
(`GET /api/system/updates`), which always answers 200 and puts the explanation in `message`:

| What the tab shows | What it means | What to do |
| --- | --- | --- |
| `No Bookarr release has been published yet…` | GitHub has drafts only, so there is nothing to compare with | publish one: `gh release edit <tag> --draft=false` (a `v*` tag also builds a Docker image) |
| `This build reports its version as "master"…` | the image was built from a branch, and `BOOKARR_VERSION` is that branch name, so no release counts as newer | compare against `ghcr.io/hoffmansweb/bookarr:latest`; a tag build reports the tag itself |
| `GitHub is rate-limiting the check…` | 60 requests an hour per IP address for anonymous callers | set `GITHUB_TOKEN` in the container environment (5000 an hour), or press the button again later |
| `GitHub could not be reached from the Bookarr server…` | no route to GitHub: offline install, DNS, proxy, TLS | expected on an offline install — nothing to fix |
| `Bookarr vX is available…` | a newer published release exists | `docker compose pull && docker compose up -d` (or Watchtower) |

Ask for the raw answer yourself:

```bash
curl -H "Authorization: Bearer <token>" "http://192.168.1.75:5057/api/system/updates?refresh=1"
```

Answers are cached for five minutes; `?refresh=1` (what the *Check for Updates* button sends) skips the
cache, and a failed check is never cached, so the next attempt talks to GitHub again. The container log
records every outcome: `docker compose logs --tail=50 bookarr | grep -i "update check"`.


### Scraper & Source Issues

#### Problem: log says `FlareSolverr failed (getaddrinfo ENOTFOUND flaresolverr)` or `FlareSolverr returned a challenge page`
Bookarr warns and immediately falls back to its built-in stealth browser. The fallback is the
normal, working path for Anna's Archive, so the warning means the `flaresolverr_url` setting
points somewhere this machine cannot use, or at an instance that cannot clear the interstitial —
nothing is broken by it. It is not retried on every fetch: the first challenge page starts the
10-minute cooldown described below.

Likeliest causes:

1. **The setting still holds the Docker-internal hostname.** `docker-compose.yml` ships
   `FLARESOLVERR_URL=http://flaresolverr:8191` as a default. That name only resolves *inside*
   that compose network, so a native (non-Docker) backend — or a container belonging to a
   different compose project — gets `ENOTFOUND`.
2. FlareSolverr is not running, or runs on another machine. A container on a different host
   needs that host's IP and a published port; the service name will never resolve.
3. An imported settings JSON (`POST /api/settings/import`) reintroduced the compose hostname.

Check it from the backend's point of view:

```sh
nslookup flaresolverr                                         # ENOTFOUND on a host install
curl -X POST http://localhost:8191/v1 -H 'Content-Type: application/json' \
     -d '{"cmd":"sessions.list"}'                             # expect {"status":"ok", ...}
```

**Fix:** Settings > Sources > *FlareSolverr URL* either points at a reachable instance
(`http://<docker-host>:8191`) or is left blank. Blank is usually better: in testing, FlareSolverr
3.5.2 answered `ok` with `"Challenge solved!"` yet returned Anna's Archive's `DDOS-GUARD` *manual
CAPTCHA* page after ~13 s — a brand-new session behaved identically, so it is not stale cookies,
and the interstitial needs a human — while Bookarr's own browser fetched the same search page and
parsed results. A reachable-but-weak FlareSolverr therefore only adds latency. A stored setting
always wins over the `FLARESOLVERR_URL` environment variable, and clearing the field deletes the
row, so the change applies immediately (no restart). The same trap exists for `searxng_url`, which
compose sets to `http://searxng:8080`.

`backend/src/scrapers/antiBot.js` keeps a 10-minute cooldown after a FlareSolverr failure **or an
interstitial it could not clear**, so one outage logs one warning ("unavailable at `<url>`") instead
of a timeout plus a warning per scrape — and a FlareSolverr that always answers with the challenge
page costs one round-trip per cooldown instead of one per fetch. The cooldown is not a permanent
ban: the next successful fetch clears it.

#### Problem: log says `Google Books search error: timeout of 10000ms exceeded` or `Google Books rate limited`
Google Books runs on a shared quota (`Queries per day`, 1,000 on the free tier) that every search,
metadata refresh and import draws on. Once it is used up the API answers HTTP 429, and while it is
close to the limit it sometimes stalls the connection instead of answering — that is where the
`timeout of 10000ms exceeded` lines come from. Neither is a Bookarr bug: Open Library, Goodreads,
Amazon and Thriftbooks keep working, the warning only means Google added nothing to that lookup.
Current logs word these as `Google Books is rate limiting (HTTP 429): … — skipping it until 9:56:01 PM`,
`Google Books unreachable: timeout of 10000ms exceeded` or `Google Books request failed: …`; single
lines such as `Google Books rate limited` come from builds older than the cooldown described below.
The unstyled request below shows the quota independently of Bookarr (`429` without a key):

```sh
curl -s -o NUL -w '%{http_code}\n' 'https://www.googleapis.com/books/v1/volumes?q=test'
```

`backend/src/services/googleBooks.js` now keeps a cooldown after a failure — 10 minutes for a timeout
or dropped connection, 15 minutes for HTTP 429 (honouring `Retry-After`) — so one outage costs a single
stalled request instead of 10 seconds per book, and logs **one warning per window** (stating how many
calls it swallowed) instead of one per call. Calls made during the cooldown are skipped without a
request and log at `debug` level only, so a production log stays quiet; the next successful call clears
the cooldown.

What to do, in order of usefulness:

1. Add a **Google Books API key** (Settings → General → Metadata): free, and it moves the lookups off
   the small anonymous quota. A `GOOGLE_BOOKS_API_KEY` still holding the
   `<your-google-books-api-key>` placeholder is ignored — the Settings value always wins.
2. If 1,000 queries/day is still not enough (a large library refreshed every two hours gets close),
   turn **Use Google Books** off in the same card. Descriptions, ISBNs and covers still arrive from
   Open Library and the scrapers, and the searches stop being delayed by Google at all.
3. Lower **Google Books timeout** (same card, default `10000` ms) if a stalled request bothers you
   more than an occasional missing description; the shorter the wait, the sooner the cooldown starts.

The metadata refresh asks Google and Open Library itself before falling back to the scrapers, so it no
longer re-queries them inside `searchAllSources` — that duplication was roughly half the daily quota.

#### Problem: the same indexer error repeats on every search — `… (Jackett) returned HTTP 400`, `… (Prowlarr) returned HTTP 429`, `Indexer … error: timeout`
One broken indexer answers the same error to every query, and the auto-search job searches once per
wanted book, so a single bad indexer used to write the same line again and again: one session logged
`… (Jackett) returned HTTP 400` 49 times and `… (Prowlarr) returned HTTP 429` 71 times while the rest
of the app was perfectly healthy. The repetition itself breaks nothing — searches run in parallel, so
each indexer's failure only costs that indexer's own results — but it buries everything else in the
log, and it means that indexer has been dead for a while.

`backend/src/services/indexerSearch.js` now logs **one warning per indexer and message per 10
minutes** and counts what it swallowed in the next warning
(`… returned HTTP 400 (12 repeats not logged)`). A different error from the same indexer, or any error
from another indexer, still warns immediately. This is a logging change only: every search still asks
every indexer. HTTP 429 was already handled separately: the indexer is skipped without a request
(`debug` level) until its `Retry-After` passes — 15 minutes when the header is missing, capped at 6
hours — and comes back on its own.

Repair the indexer to quieten it for good:

1. **Settings → Downloads → Indexers** → *Test* on the entry. `401`/`403` means the API key is stale:
   re-import the indexer (*Connect Prowlarr / Jackett*, or let the *Indexer refresh* job do it daily at
   04:17).
2. `400`/`404` means the URL or the category ids no longer match — a retired tracker, a changed port,
   or an indexer disabled inside Jackett. Re-import it or delete it in Bookarr; an indexer that is
   switched off upstream answers `400` forever.
3. `429` from Prowlarr usually means Prowlarr is rate limiting Bookarr, or is passing an upstream 429
   through. Leave it alone: the cooldown above stops Bookarr provoking it tens of times an hour.
4. `error: timeout` means the indexer did not answer within 15 s. Trackers behind Cloudflare are only
   usable through Prowlarr's proxy; without it they will always time out.

### Download & Import Issues

#### Problem: "Import failed … Move failed" / ENOENT for a download that finished
Symptoms: the client shows the download as completed and the file really is on disk,
but the log repeats this every minute:

```
[Bad Bishop] Source path from client: "\\nas\Downloads\Downloads\Bad Bishop (Society of Villains, Book 1) - L.J. Shen"
[Bad Bishop] Original path failed, checking parent directory: \\nas\Downloads\Downloads
[Bad Bishop] Failed to move file: ENOENT ENOENT: no such file or directory, stat '…'
[error]: Import failed for "Bad Bishop": Move failed
```

Why: the name Bookarr matched on is the **release name**, which is usually not the name
of the file inside the download, and with a category folder the finished file sits one
level below the completed-downloads folder. A client in Docker reports its own paths
(`/data/downloads/...`) as well, and Bookarr cannot read those.

**Solution:** Bookarr tries every path the client reports plus the category folder under
`download_folder`, so normally the fix is to make the folder settings match reality
(Settings → General):

- **Completed downloads folder** (`download_folder`) is the folder that *contains* the
  client's category folders, as seen from this machine, e.g.
  `\\nas\Downloads\Downloads` — not `…\Downloads\Downloads\books`.
- **Downloads share username/password** must allow Bookarr to read that share.
- If the client runs in a container, or the two machines disagree about the path, map
  the client's paths (`;` between mappings, `\` doubled in `.env`):
  ```bash
  # backend/.env — client path on the left, the real path on the right
  DOWNLOAD_PATH_REMAP=/data/downloads=\\nas\Downloads;/downloads=\\nas\complete
  ```
  Restart the backend after editing `.env`. This is the same idea as
  `LIBRARY_PATH_REMAP` (see `backend/src/controllers/bookController.js`).
- Imports retry every minute while the book is `downloading`, and the log lists every
  path it tried when it still cannot find the book.

### Reader & Playback Issues

#### Problem: the reader flickers and nothing can be clicked (playback can't be stopped)
Symptoms: `Read`/`Play` opens the player, but the moment the pointer moves the whole
overlay jumps or vanishes for an instant, clicks land on the page *behind* it (book cards
open, the navbar reacts) and the transport controls never respond — so playback cannot be
stopped.

Why: `Reader` used to be rendered *inside* its host element (`BookCard`,
`BookDetailsModal`, `AuthorModal`), and `.book-card:hover { transform: translateY(-4px) }`
turns the card into the containing block for `position: fixed` descendants. Hovering the
card therefore teleported the full-screen overlay into the card's box, the pointer left
the card, hover cleared, the overlay snapped back — an endless hover/teleport loop (the
flicker) — and every click was delivered to whatever occupied that point on the page
behind. `document.querySelector('.reader-overlay').getBoundingClientRect()` measured
`{x: 251, y: 1888}` while hovering, versus `{0, 0, viewport}` otherwise.

**Solution:** the overlay is rendered through `createPortal(…, document.body)` in
`frontend/src/components/Reader.js`, so `position: fixed` always resolves against the
viewport. Keep new full-screen overlays portalled, or at least never inside an element
with `transform`, `filter`, `perspective`, `contain` or `will-change` — otherwise this
bug returns. Quick check for any overlay: move the mouse over it and confirm
`elementFromPoint()` at its centre returns the overlay (or one of its children), and that
`getBoundingClientRect()` does not change while hovering.

Rebuild the frontend after touching this (`npm run build` in `frontend/`, or the root
`npm run build`), then hard-refresh the browser so it stops using the cached bundle.

#### Books star themselves when you start reading or listening

Opening the reader is *not* the trigger — the first saved progress write is. The reader only POSTs
progress after real engagement: audiobooks save `POST /api/books/:id/progress` once more than 5
seconds have played (and every 10 seconds while playing), ebooks save
`POST /api/books/:id/reading-progress` every 10 seconds while open and once on close. Whichever
lands first stars the book, so opening a book by accident and closing it again leaves it unstarred.

Only that first write stars. Clearing the ⭐ yourself keeps it cleared while you keep reading, so
the feature can never fight your own choice.

Both endpoints answer `{ success: true, starred, autoStarred }`. `autoStarred: true` means *this*
request set the star — that is what lets the reader toast "⭐ Added to Favorites" and fill in the
card's star without a reload. No extra request is made for any of this, and the star is written to
the same `UserBooks` row that stores the reading/listening position
(`backend/src/controllers/bookController.js`, `saveProgress`).

**Turn it off:** Settings → General → *Reading & listening* → "Star books when I start reading or
listening" (stored as `auto_star_on_start = 'false'` in the settings table; the backend treats a
missing key as on). With it off, books are only starred by clicking the ☆ on a card, in an author's
book list, or from the Dashboard.

### Docker Issues

#### Problem: Docker containers won't start
```bash
# Check Docker is running
docker --version

# View container logs (Bookarr is one container; the sidecars are separate services)
docker compose logs bookarr
docker compose logs flaresolverr
docker compose logs searxng

# Restart
docker compose down
docker compose up -d

# Build the image locally instead of pulling it
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

**Solution:**
- Ensure Docker (or Docker Desktop) is running
- Check for a port conflict on `BOOKARR_PORT` (default 5000)
- `docker compose config` prints the resolved values from your `.env`
- Review container logs; Bookarr's own logs are also in the data volume
  (`/app/data/logs`, `docker compose exec bookarr ls -l /app/data/logs`)

#### Problem: Database data lost after restart
Bookarr keeps everything in the `bookarr_data` volume, so the container can be replaced freely.

**Solution:**
```bash
# Is the volume still there and is the database inside it?
docker volume ls | findstr bookarr
docker compose exec bookarr ls -l /app/data          # database.sqlite + backups/

# Don't delete volumes:  docker compose down -v  wipes the database, settings and API keys
docker compose down            # keeps volumes (correct)
```

- Mount the same volume on a recreated container (the compose file does this automatically)
- Nightly snapshots live in `/app/data/backups` — copy one back over `database.sqlite` to roll
  back after an accidental delete

## 🚀 Performance Optimization

### Backend Optimization

1. **Enable Query Caching**
```javascript
// Add Redis for caching (future enhancement)
// Cache frequently accessed data
// Cache search results temporarily
```

2. **Optimize Database Queries**
```javascript
// Use eager loading
Book.findAll({
  include: [{ model: Author, as: 'author' }]
});

// Add indexes for common queries
// Limit results with pagination
```

3. **Rate Limiting**
```javascript
// Add rate limiting middleware
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

### Frontend Optimization

1. **Lazy Loading**
```javascript
// Lazy load pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Books = lazy(() => import('./pages/Books'));
```

2. **Memoization**
```javascript
// Memoize expensive computations
const memoizedValue = useMemo(() => 
  computeExpensiveValue(a, b), 
  [a, b]
);
```

3. **Pagination**
```javascript
// Implement pagination for large lists
// Load books in batches of 20-50
// Use infinite scroll or page numbers
```

## 📊 Monitoring & Debugging

### Enable Debug Logging

**Backend:**
```javascript
// In backend/src/config/logger.js
level: 'debug'  // Show all logs
```

**Frontend:**
```javascript
// Add to components
console.log('Component state:', state);
console.log('API response:', response);
```

### Monitor API Calls

**Browser DevTools:**
1. Open DevTools (F12)
2. Go to Network tab
3. Filter by XHR/Fetch
4. Watch API requests/responses

**Backend Logs:**
```bash
# Watch logs in real-time
tail -f backend/logs/combined.log

# Search for errors
type backend\logs\error.log | findstr "error"
```

### Database Monitoring

```sql
-- Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check active connections
SELECT * FROM pg_stat_activity;

-- Check slow queries
SELECT * FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;
```

## 🔐 Security Best Practices

1. **Change Default Secrets**
```bash
# Generate strong JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Update in .env
JWT_SECRET=<generated-secret>
```

2. **Use Environment Variables**
- Never commit `.env` files
- Use different secrets for dev/prod
- Rotate secrets regularly

3. **Enable HTTPS in Production**
```javascript
// Use reverse proxy (nginx) with SSL
// Or use services like Cloudflare
```

4. **Implement Rate Limiting**
```javascript
// Prevent brute force attacks
// Limit API requests per IP
// Add CAPTCHA for registration
```

5. **Validate All Input**
```javascript
// Use express-validator
// Sanitize user input
// Validate on both frontend and backend
```

## 📈 Scaling Tips

### Horizontal Scaling
- Use load balancer (nginx)
- Run multiple backend instances
- Use Redis for session storage
- Implement message queue (RabbitMQ)

### Vertical Scaling
- Increase server resources
- Optimize database queries
- Add database indexes
- Use connection pooling

### Database Scaling
- Use read replicas
- Implement caching layer
- Partition large tables
- Archive old data

## 🎓 Learning Resources

### Understanding the Code
1. Start with `backend/src/server.js`
2. Follow route → controller → service flow
3. Review model relationships
4. Understand middleware chain

### Extending the Application
1. Add new API endpoint:
   - Create route in `routes/`
   - Add controller in `controllers/`
   - Update model if needed

2. Add new page:
   - Create component in `pages/`
   - Add route in `App.js`
   - Create API calls in `services/api.js`

3. Add new feature:
   - Plan database changes
   - Update models
   - Create API endpoints
   - Build UI components

## 🆘 Getting Help

### Check These First
1. Review error messages carefully
2. Check logs (backend/logs/)
3. Verify environment configuration
4. Test with simple cases first
5. Check external API status

### Debug Checklist
- [ ] Database file exists and is writable (`backend/database.sqlite`, Docker: `/app/data/database.sqlite`)
- [ ] Database exists and is accessible
- [ ] Backend server is running (port 5000)
- [ ] Frontend server is running (port 3000)
- [ ] Environment variables are set
- [ ] API keys are valid
- [ ] No port conflicts
- [ ] Internet connection is working
- [ ] Browser console shows no errors
- [ ] Network requests are successful

### Common Error Messages

**"ECONNREFUSED"**
- Service is not running
- Wrong host/port
- Firewall blocking connection

**"401 Unauthorized"**
- Invalid or expired token
- Missing authentication header
- User not logged in

**"404 Not Found"**
- Wrong API endpoint
- Resource doesn't exist
- Route not registered

**"500 Internal Server Error"**
- Check backend logs
- Database error
- Unhandled exception

**"CORS Error"**
- Backend CORS not configured
- Wrong origin in request
- Missing credentials

## 💡 Feature Ideas

Want to extend Bookarr? Try adding:

1. **Email Notifications**
   - Use nodemailer
   - Send digest emails
   - Configurable preferences

2. **Book Recommendations**
   - Based on reading history
   - Similar books algorithm
   - Collaborative filtering

3. **Reading Statistics**
   - Books read per month
   - Pages read
   - Reading speed
   - Favorite genres

4. **Social Features**
   - Share reading lists
   - Follow other users
   - Book clubs
   - Reviews and ratings

5. **Advanced Search**
   - Filter by genre
   - Filter by publication year
   - Filter by rating
   - Sort options

6. **Import/Export**
   - Export library to CSV
   - Import from Goodreads
   - Backup/restore data

7. **Mobile App**
   - React Native version
   - Barcode scanner
   - Offline mode

8. **Integration**
   - Calibre integration
   - E-reader sync
   - Library catalog search
   - Amazon price tracking

Happy reading! 📚✨
