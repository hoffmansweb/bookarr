// qBittorrent authentication shared by every qBittorrent call.
// - API key (qBittorrent >= 5.2, WebUI → Options → API key, "qbt_…"): sent as
//   `Authorization: Bearer <key>` on every request; no login/cookie round-trip.
// - Otherwise: username/password login to /api/v2/auth/login, then the SID cookie.
const axios = require('axios');

const baseUrlFor = (client) => `${client.useSsl ? 'https' : 'http'}://${client.host}:${client.port}`;

// The API key lives in the client's apiKey field. qBittorrent keys always start with "qbt_";
// older Bookarr setups sometimes put the password in apiKey, so anything else is treated as a password.
const usesApiKey = (client) => /^qbt_/i.test(String(client.apiKey || '').trim());

/**
 * Headers that authenticate requests to this qBittorrent instance.
 * @returns {Promise<object>} e.g. { Authorization: 'Bearer qbt_…' } or { Cookie: 'SID=…' }
 */
const qbAuthHeaders = async (client, baseUrl = baseUrlFor(client)) => {
  if (usesApiKey(client)) return { Authorization: `Bearer ${String(client.apiKey).trim()}` };

  const body = new URLSearchParams({ username: client.username || 'admin', password: client.password || client.apiKey || '' }).toString();
  const res = await axios.post(`${baseUrl}/api/v2/auth/login`, body, {
    // qBittorrent's CSRF protection rejects requests without a matching Referer/Origin
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: baseUrl, Origin: baseUrl },
    timeout: 15000,
    validateStatus: s => s < 500
  });
  if (res.status === 403) throw new Error('qBittorrent: IP banned after too many failed logins');
  if (res.status >= 400 || (typeof res.data === 'string' && /fail/i.test(res.data))) {
    throw new Error('qBittorrent login failed (check username/password, or use an API key)');
  }
  const cookie = res.headers['set-cookie']?.[0]?.split(';')[0];
  // No cookie + "Ok." happens when auth is bypassed for localhost/whitelisted subnets
  return cookie ? { Cookie: cookie } : {};
};

/**
 * Check connectivity + auth; returns the qBittorrent version.
 */
const testConnection = async (client) => {
  const baseUrl = baseUrlFor(client);
  const headers = await qbAuthHeaders(client, baseUrl);
  const res = await axios.get(`${baseUrl}/api/v2/app/version`, { headers, timeout: 10000, validateStatus: s => s < 500 });
  if (res.status === 401 || res.status === 403) {
    throw new Error(usesApiKey(client)
      ? 'qBittorrent rejected the API key (needs qBittorrent 5.2+ and a key from WebUI → Options)'
      : 'qBittorrent rejected the login');
  }
  if (res.status >= 400) throw new Error(`qBittorrent returned HTTP ${res.status}`);
  return String(res.data).trim();
};

module.exports = { qbAuthHeaders, testConnection, usesApiKey, baseUrlFor };
