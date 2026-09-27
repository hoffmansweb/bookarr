// Bookarr service worker.
//
// Two jobs: keep epub/audiobook downloads on the device so the reader works offline, and act
// as a stale-while-revalidate cache for the static app shell. Everything else - API JSON above
// all - goes straight to the network.
const CACHE_PREFIX = 'bookarr-cache-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const BOOKS_CACHE = 'bookarr-books';
const BOOK_FILE = /^\/api\/books\/[^/]+\/file/;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Drop caches written by earlier versions of this worker (v1 stored API replies, which the
  // fetch handler below no longer reads). The book cache is kept on purpose - those files are
  // large and re-downloading them is exactly what offline reading is meant to avoid.
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only GETs are cacheable, and range requests must never be answered from the cache: seeking
  // in an audiobook sends `Range: bytes=500000-`, the backend answers with 206 Partial Content,
  // and a stored whole-file response would shadow it and break playback.
  if (request.method !== 'GET' || request.headers.has('range')) {
    return;
  }

  // Downloads are the one thing worth persisting locally.
  if (BOOK_FILE.test(url.pathname)) {
    event.respondWith(bookFile(request));
    return;
  }

  // API replies belong to the token that asked for them, but Cache Storage keys entries by URL
  // alone - the Authorization header is not part of the key - so a stored profile or library
  // response would be replayed to whoever requests that URL next. Socket.IO polls and covers
  // hosted elsewhere are just as pointless to keep. Leave all of it to the network.
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
    return;
  }

  // The HTML document (navigation requests) must stay fresh: it names the current JS/CSS
  // bundle, so serving it stale left an old bundle in place after an update and an old UI kept
  // calling the API with the old bug. Network-first with a cache fallback keeps the app usable
  // offline without pinning an old build.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Same-origin static output: JS/CSS chunks, icons (all hashed/immutable).
  event.respondWith(staleWhileRevalidate(request));
});

// Network-first for the entry document: get the latest index.html, fall back to the cached
// copy when there is no connection.
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const copy = networkResponse.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return networkResponse;
  } catch (error) {
    const cached = await caches.match(request);
    return cached || Response.error();
  }
}

// Cache-first: a file that already sits on disk does not change under us.
async function bookFile(request) {
  const cache = await caches.open(BOOKS_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached; // Return cached book!
  }

  const networkResponse = await fetch(request);
  if (networkResponse.status === 200) {
    // Clone before returning: the page starts reading the body the moment we hand the response
    // over, and a Response can only be cloned while its body is still untouched.
    cache.put(request, networkResponse.clone()).catch(() => {});
  }
  return networkResponse;
}

// Stale-while-revalidate: serve what we have, refresh it in the background.
function staleWhileRevalidate(request) {
  return caches.match(request).then((cachedResponse) => {
    const networkFetch = fetch(request).then((networkResponse) => {
      if (networkResponse.status === 200) {
        // The clone has to happen right here. Cloning it later - inside the caches.open()
        // callback - threw "Response body is already used", because by then the body had been
        // handed to the page; the rejection was unhandled and nothing was cached either.
        const copy = networkResponse.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(request, copy))
          .catch(() => {}); // a cache write must never break the page's response
      }
      return networkResponse;
    });

    return cachedResponse || networkFetch;
  });
}
