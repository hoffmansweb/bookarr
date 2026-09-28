import axios from 'axios';

// Dynamically determine API URL based on current host
const getApiUrl = () => {
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }
  // Dev server (port 3000) talks to the backend on :5000. Otherwise the backend serves this
  // page itself (Docker), so use the same origin — works with any port mapping or reverse proxy.
  const { protocol, hostname, port, origin } = window.location;
  if (port === '3000') return `${protocol}//${hostname}:5000/api`;
  return `${origin}/api`;
};

const API_URL = getApiUrl();

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // The default above is application/json, and axios acts on that header before the request is sent:
  // a FormData body posted under it is turned into a JSON string (axios lib/defaults/index.js,
  // transformRequest). A backup upload therefore arrived as {"dbFile":{}} - the file already gone -
  // and the API answered 400 "the request body was sent as application/json". Clearing the header for
  // uploads hands the job back to the browser, which sets multipart/form-data itself, boundary
  // included; a hand-written 'multipart/form-data' cannot, which is why this must be deleted
  // rather than replaced.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config.url.includes('/amazon/')) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  getProfile: () => api.get('/auth/profile')
};

export const bookAPI = {
  search: (query) => api.get('/books/search', { params: { query } }),
  getAll: (params) => api.get('/books', { params }),
  getEbooks: (params) => api.get('/books', { params: { ...params, mediaType: 'ebook' } }),
  getAudiobooks: (params) => api.get('/books', { params: { ...params, mediaType: 'audiobook' } }),
  getById: (id) => api.get(`/books/${id}`),
  create: (data) => api.post('/books', data),
  // Add a search result and immediately start looking for it (formats from the auto_get_formats setting)
  grab: (book) => api.post('/books/grab', book),
  // Add every book in a series (adds + starts acquiring each one)
  addSeries: (series, author) => api.post('/books/add-series', { series, author }),
  update: (id, data) => api.put(`/books/${id}`, data),
  delete: (id) => api.delete(`/books/${id}`),
  addToLibrary: (id) => api.post(`/books/${id}/library`),
  getLibrary: () => api.get('/books/library'),
  getStarred: () => api.get('/books/starred'),
  getContinueReading: () => api.get('/books/continue-reading'),
  getContinueListening: () => api.get('/books/continue-listening'),
  // Dashboard "New Arrivals": { limit, days } are optional
  getRecentArrivals: (params) => api.get('/books/recent-arrivals', { params }),
  toggleStar: (id) => api.post(`/books/${id}/star`),
  updateProgress: (id, data) => api.post(`/books/${id}/book-progress`, data),
  getProgress: (id) => api.get(`/books/${id}/progress`),
  // Tells the reader whether the file is reachable before it tries to download it
  getFileStatus: (id) => api.get(`/books/${id}/file-status`),
  checkAmazonConnection: () => api.get('/books/amazon/check'),
  setAmazonCookies: (data) => api.post('/books/amazon/cookies', data),
  getAmazonMyBooks: () => api.get('/books/amazon/my-books'),
  getAmazonBestsellers: () => api.get('/books/amazon/bestsellers'),
  getAmazonNewReleases: () => api.get('/books/amazon/new-releases')
};

export const authorAPI = {
  searchExternal: (query) => api.get('/author-search/search-external', { params: { query } }),
  addAuthor: (data) => api.post('/author-search/add', data),
  getAll: (params) => api.get('/authors', { params }),
  getById: (id) => api.get(`/authors/${id}`),
  create: (data) => api.post('/authors', data),
  update: (id, data) => api.put(`/authors/${id}`, data),
  delete: (id) => api.delete(`/authors/${id}`),
  monitor: (id) => api.post(`/authors/${id}/monitor`),
  unmonitor: (id) => api.delete(`/authors/${id}/monitor`),
  getMonitored: () => api.get('/authors/monitored'),
  refresh: (id) => api.post(`/authors/${id}/refresh`),
  toggleAllBooks: (id, status) => api.post(`/authors/${id}/toggle-books`, { status }),
  // Search every wanted book by this author (background; progress on the `author:search` socket event)
  searchWanted: (id) => api.post(`/authors/${id}/search-wanted`)
};

export const notificationAPI = {
  getAll: (params) => api.get('/notifications', { params }),
  markAsRead: (id) => api.put(`/notifications/${id}/read`),
  markAllAsRead: () => api.put('/notifications/read-all'),
  delete: (id) => api.delete(`/notifications/${id}`)
};

export const downloadClientAPI = {
  getAll: () => api.get('/download-clients'),
  create: (data) => api.post('/download-clients', data),
  update: (id, data) => api.put(`/download-clients/${id}`, data),
  delete: (id) => api.delete(`/download-clients/${id}`),
  test: (data) => api.post('/download-clients/test', data)
};

export const indexerAPI = {
  getAll: () => api.get('/indexers'),
  create: (data) => api.post('/indexers', data),
  update: (id, data) => api.put(`/indexers/${id}`, data),
  delete: (id) => api.delete(`/indexers/${id}`),
  test: (data) => api.post('/indexers/test', data),
  // Prowlarr / Jackett auto-setup: kind = 'prowlarr' | 'jackett'
  discover: (kind, url, apiKey) => api.post('/indexers/discover', { kind, url, apiKey }, { timeout: 30000 }),
  sync: (data) => api.post('/indexers/sync', data, { timeout: 60000 })
};

export const settingsAPI = {
  getAll: () => api.get('/settings'),
  update: (data) => api.put('/settings', data),
  getDrives: () => api.get('/settings/drives'),
  getFolders: (path) => api.get('/settings/folders', { params: { path } }),
  export: () => api.get('/settings/export'),
  import: (data) => api.post('/settings/import', data)
};

export const bulkAPI = {
  updateBooks: (bookIds, status) => api.put('/bulk/bulk-update', { bookIds, status })
};

export const nzbAPI = {
  // Anna's Archive + indexers; Anna's can take up to ~75s on a cold start
  search: (title, author, extra = {}) => api.get('/nzb/search', { params: { title, author, ...extra }, timeout: 120000 }),
  download: (data) => api.post('/nzb/download', data),
  status: () => api.get('/nzb/status'),
  youtubeSearch: (title, author) => api.get('/nzb/youtube/search', { params: { title, author } }),
  youtubeDownload: (data) => api.post('/nzb/youtube/download', data),
  // Google/web + LibriVox + Internet Archive + YouTube
  audiobookSearch: (title, author) => api.get('/nzb/audiobook/search', { params: { title, author }, timeout: 120000 }),
  audiobookDownload: (bookId, result) => api.post('/nzb/audiobook/download', { bookId, result }),
  audiobookAuto: (bookId) => api.post('/nzb/audiobook/auto', { bookId }, { timeout: 120000 }),
  // Start any search result: YouTube/LibriVox/Archive/web go through the audiobook pipeline,
  // everything else (Anna's, NZB, torrent) through the download endpoint
  startDownload: (result, bookId) => (PIPELINE_TYPES.includes(result.type)
    ? api.post('/nzb/audiobook/download', { bookId, result })
    : api.post('/nzb/download', {
      url: result.downloadUrl, md5: result.md5, title: result.title, bookId, type: result.type, format: result.format
    }))
};

// Result types handled by the in-app audiobook pipeline (download -> M4B -> library)
export const PIPELINE_TYPES = ['youtube', 'web', 'librivox', 'archive'];

export const jobsAPI = {
  list: () => api.get('/jobs'),
  // An empty body must be an object, not null: with the application/json default, axios turns
  // null into the literal string "null", which body-parser's strict JSON mode rejects (500).
  run: (id) => api.post(`/jobs/${id}/run`, {}, { timeout: 0 }),
  runMonitoring: () => api.post('/jobs/monitoring'),
  runSearch: () => api.post('/jobs/search'),
  runDownloadCheck: () => api.post('/jobs/download-check'),
  runLibrarySync: () => api.post('/jobs/library-sync'),
  runBooksRefresh: () => api.post('/jobs/books-refresh')
};

export const libraryAPI = {
  scan: () => api.post('/library/scan')
};

export const ttsAPI = {
  getVoices: (provider) => api.get('/tts/voices', { params: { provider } }),
  testLocal: () => api.get('/tts/test-local'),
  convert: (bookId, data) => api.post(`/tts/convert/${bookId}`, data || {}),
  convertStatus: (bookId) => api.get(`/tts/convert/${bookId}`),
  updateSettings: (data) => api.put('/auth/tts-settings', data)
};

export const activityAPI = {
  getQueue: () => api.get('/activity/queue'),
  getHistory: () => api.get('/activity/history'),
  cancelQueueItem: (id) => api.delete(`/activity/queue/${id}`)
};

export const calendarAPI = {
  getEvents: (params) => api.get('/calendar', { params })
};

export const systemAPI = {
  getStatus: () => api.get('/system/status'),
  getLogs: () => api.get('/system/logs'),
  // The backend asks GitHub, not the browser: a repository without a published release answers 404
  // for /releases/latest (a red error in the console, with the reason hidden behind "Could not fetch
  // update data"), and the anonymous GitHub limit is 60 requests an hour per IP address.
  checkUpdates: (force) => api.get('/system/updates', { params: force ? { refresh: 1 } : {}, timeout: 25000 }),
  downloadBackup: () => api.get('/system/backup/download', { responseType: 'blob' }),
  // No Content-Type here on purpose. Only the browser knows the multipart boundary, and it is part of
  // that header: sending 'multipart/form-data' by hand leaves the boundary out, and express-fileupload
  // then ignores the whole request (the API only sees "no file" and answers 400). The interceptor above
  // additionally clears this instance's application/json default, which would otherwise turn the
  // upload into JSON - see api.uploads.test.js.
  restoreBackup: (formData) => api.post('/system/backup/restore', formData)
};

export default api;
