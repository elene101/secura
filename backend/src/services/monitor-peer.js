const { timingSafeEqual } = require('node:crypto');
const { ping, normalizeUrl } = require('./scanner');

function sharedSecret() {
  return process.env.MONITOR_PEER_KEY?.length >= 32 ? process.env.MONITOR_PEER_KEY : null;
}

async function confirmFromPeer(site, options) {
  const key = sharedSecret();
  const endpoint = process.env.MONITOR_PEER_URL;
  if (!site.verifiedAt || !key || !endpoint) return null;
  try {
    const url = new URL('/api/monitor-peer/check', endpoint);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ url: site.url, ...options })
    });
    if (!response.ok) return null;
    const result = await response.json();
    return typeof result.up === 'boolean' ? result : null;
  } catch { return null; }
}

async function receive(req, res) {
  const key = sharedSecret();
  if (!key || process.env.MONITOR_PEER_ACCEPT !== '1') return res.sendStatus(404);
  const actual = Buffer.from(req.get('authorization') || '');
  const expected = Buffer.from('Bearer ' + key);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.sendStatus(401);
  const url = normalizeUrl(req.body.url);
  const expectedStatus = Number.isInteger(req.body.expectedStatus) ? req.body.expectedStatus : null;
  const expectedText = typeof req.body.expectedText === 'string' ? req.body.expectedText.slice(0, 200) : '';
  const result = await ping(url.href, { body: !!expectedText, expectedStatus, expectedText });
  res.json({ up: result.up, reason: result.reason });
}
module.exports = { confirmFromPeer, receive };
