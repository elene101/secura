// CSRF დაცვა 3 დონეზე: SameSite cookie, Origin შემოწმება, და სესიის მქონე მოთხოვნებზე ორმაგი ტოკენი (cookie + header)
const crypto = require('crypto');
const { FRONTEND_URL, API_BASE, EXTRA_ORIGINS } = require('../config/env');
const { parseCookies } = require('../helpers/cookies');
const { SESSION, CSRF } = require('../helpers/session');
const ORIGINS = new Set([FRONTEND_URL, API_BASE, ...EXTRA_ORIGINS].map(u => { try { return new URL(u).origin; } catch { return null; } }).filter(Boolean));
const same = (a, b) => /^[0-9a-f]{48}$/.test(a) && /^[0-9a-f]{48}$/.test(b) &&
  crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
module.exports = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/payments/bog/callback') return next(); // ბანკის გამოძახება მოწმდება ბანკის API-დან
  const origin = req.headers.origin;
  if (origin && !ORIGINS.has(origin)) return res.status(403).json({ error: 'Invalid request' });
  const c = parseCookies(req.headers.cookie);
  if (c[SESSION]) {
    const h = String(req.headers['x-csrf-token'] || ''), ck = String(c[CSRF] || '');
    if (!h || !ck || !same(h, ck)) return res.status(403).json({ error: 'Invalid request' });
  }
  next();
};
