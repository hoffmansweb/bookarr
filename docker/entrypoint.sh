#!/bin/sh
set -e

# YouTube and other sites break old yt-dlp versions often; refresh it in the
# background on each start so the image doesn't need rebuilding. Disable with
# YTDLP_AUTO_UPDATE=false.
if [ "${YTDLP_AUTO_UPDATE:-true}" = "true" ]; then
  ( /opt/venv/bin/pip install --no-cache-dir --quiet --upgrade "yt-dlp[default]" >/dev/null 2>&1 \
      && echo "yt-dlp updated to $(/opt/venv/bin/yt-dlp --version)" ) &
fi

mkdir -p /app/data /app/tts/cache /downloads /library/ebooks /library/audiobooks "${BOOKARR_WORK_DIR:-/downloads/.bookarr-work}"

# Optional: run the app as a given UID/GID so downloaded books are owned by your host user
# instead of root. Set PUID/PGID in .env to the ids from `id -u` / `id -g`. Unset (or 0)
# keeps the default root behaviour, which is what you need when the mounts are only
# writable by root, e.g. some NAS shares.
PUID="${PUID:-0}"
PGID="${PGID:-0}"
if [ "$PUID" != "0" ] || [ "$PGID" != "0" ]; then
  if command -v setpriv >/dev/null 2>&1; then
    # Only the app's own state and scratch space - never recurse into an existing library.
    chown -R "$PUID:$PGID" /app/data /app/tts/cache 2>/dev/null || true
    chown "$PUID:$PGID" "${BOOKARR_WORK_DIR:-/downloads/.bookarr-work}" 2>/dev/null || true
    # The image's HOME points at /root, which the downgraded user cannot read. Puppeteer's
    # config lookup (cosmiconfig) stats $HOME/.config on startup and would crash with EACCES,
    # so point HOME at the app's own (already-chowned) data directory instead.
    export HOME=/app/data
    echo "Running as UID $PUID / GID $PGID"
    set -- setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
  else
    echo "PUID/PGID set but setpriv is unavailable - staying as root" >&2
  fi
fi

exec "$@"
