# syntax=docker/dockerfile:1

# ---------- Frontend build ----------
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY frontend/ ./
# CI=false: CRA promotes lint warnings to build errors whenever CI is set (GitHub Actions sets
# it for `run` steps). GENERATE_SOURCEMAP=false keeps the image smaller - the maps are useless
# without the sources, which aren't shipped.
ENV CI=false \
    GENERATE_SOURCEMAP=false
RUN npm run build

# ---------- Backend dependencies ----------
# Build tools are only needed here, in case a native module (sqlite3, bcrypt) has no prebuilt binary
FROM node:22-bookworm-slim AS backend-deps
# yt-dlp-exec's preinstall runs `npx bin-version-check-cli python ">=2"`, and Debian only ships
# python3 - without a `python` on PATH the whole npm ci fails. The runtime uses the pip-installed
# yt-dlp in /opt/venv, so this shim is only needed while the node deps are installed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && ln -sf /usr/bin/python3 /usr/local/bin/python
WORKDIR /app
COPY backend/package*.json ./
# System chromium / yt-dlp / ffmpeg are used at runtime, so skip the npm-bundled downloads
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    YOUTUBE_DL_SKIP_DOWNLOAD=true
# --legacy-peer-deps: npm install on a dev machine (npm 11) can rewrite the lock in a way that
# npm 10 in this image refuses - it tries to satisfy an optional peer dep the lock does not list.
RUN npm ci --omit=dev --omit=optional --legacy-peer-deps --no-audit --no-fund

# ---------- Runtime ----------
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="Bookarr" \
      org.opencontainers.image.description="Self-hosted book and audiobook manager (web UI + API in one container)" \
      org.opencontainers.image.licenses="MIT"

# chromium: Anna's Archive / scrapers (DDoS-Guard needs a real browser)
# ffmpeg:   audiobook download + M4B conversion, chapter probing
# python3:  Edge TTS (read-aloud) and yt-dlp
# tini:     proper signal handling / zombie reaping for chromium child processes
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-core \
      ffmpeg \
      python3 python3-venv \
      ca-certificates tzdata tini \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir edge-tts "yt-dlp[default]"

ARG BOOKARR_VERSION="develop"
ENV BOOKARR_VERSION=${BOOKARR_VERSION} \
    NODE_ENV=production \
    PORT=5000 \
    PATH=/opt/venv/bin:$PATH \
    PYTHON_PATH=/opt/venv/bin/python \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    YOUTUBE_DL_DIR=/opt/venv/bin \
    YOUTUBE_DL_SKIP_DOWNLOAD=true \
    BOOKARR_WORK_DIR=/downloads/.bookarr-work \
    DOWNLOAD_FOLDER=/downloads \
    EBOOKS_FOLDER=/library/ebooks \
    AUDIOBOOKS_FOLDER=/library/audiobooks

WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY backend/ ./
COPY --from=frontend-build /app/frontend/build ./public
COPY docker/entrypoint.sh /usr/local/bin/bookarr-entrypoint
RUN chmod +x /usr/local/bin/bookarr-entrypoint \
 && mkdir -p /app/data /downloads /library/ebooks /library/audiobooks /app/tts/cache

# Database, JWT secret, nightly backups and logs live in /app/data
# Set PUID/PGID (see docker/entrypoint.sh) to run as your host user instead of root.
VOLUME ["/app/data", "/downloads", "/library"]
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "bookarr-entrypoint"]
CMD ["node", "src/server.js"]
