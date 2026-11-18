const tls = require('tls'), dns = require('dns').promises, net = require('net');
const { request, safeLookup, isBlockedIp, assertSafeUrl } = require('./netsafe');
const { UserError } = require('../helpers/errors');
const { publicUrl, safeWork } = require('./scan-work');
const { whoisExpiry } = require('./whois');

function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u || u.length > 2048) throw new UserError('Invalid address');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  let url; try { url = new URL(u); } catch { throw new UserError('Invalid address'); }
  assertSafeUrl(url);
  url.hash = '';
  return url;
}
async function assertPublic(host) { // ადრეული შემოწმება (რეალური დაცვა კავშირის დამყარებისას მოქმედებს, netsafe.js-ში)
  if (net.isIP(host)) { if (isBlockedIp(host)) throw new UserError('Scanning local addresses is not allowed'); return; }
  let addrs; try { addrs = await withTimeout(dns.lookup(host, { all: true }), 5000); } catch { throw new UserError('Invalid address'); }
  if (addrs.some(a => isBlockedIp(a.address))) throw new UserError('Scanning local addresses is not allowed');
}
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function checkSSL(host) {
  return new Promise(resolve => {
    if (net.isIP(host)) return resolve({ ok: false, days: null, error: 'IP address' });
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, lookup: safeLookup }, () => {
      const c = s.getPeerCertificate(), days = c.valid_to ? Math.floor((new Date(c.valid_to) - Date.now()) / 864e5) : null;
      resolve({ ok: s.authorized, days, issuer: c.issuer?.O || '—', error: s.authorizationError || null }); s.end();
    });
    const deadline = setTimeout(() => { s.destroy(); resolve({ ok: false, days: null, error: 'timeout' }); }, 6000);
    s.once('close', () => clearTimeout(deadline));
    s.on('error', e => resolve({ ok: false, days: null, error: e.message }));
  });
}
const HEADERS = {
  'strict-transport-security': 'HSTS', 'content-security-policy': 'CSP', 'x-frame-options': 'X-Frame-Options',
  'x-content-type-options': 'X-Content-Type-Options', 'referrer-policy': 'Referrer-Policy', 'permissions-policy': 'Permissions-Policy'
};
async function performPing(url, { body = false, expectedStatus, expectedText } = {}) {
  try {
    const r = await request(url, { readBody: body, timeout: 10000 });
    const goodStatus = expectedStatus ? r.status === expectedStatus : r.status >= 200 && r.status < 300;
    const reason = r.tlsError ? 'TLS' : !goodStatus ? 'HTTP ' + r.status : expectedText && !r.body.includes(expectedText) ? 'CONTENT_MISMATCH' : null;
    return { up: reason === null, reason, status: r.status, ms: r.ms, headers: { has: k => k in r.headers }, response: r };
  } catch (e) { return { up: false, status: 0, ms: 0, error: e.code || 'UNREACHABLE', reason: e instanceof UserError ? 'TARGET_BLOCKED' : e.code || 'UNREACHABLE', headers: { has: () => false }, response: null }; }
}

// ---------- დამატებითი შემოწმებები ----------
const SLD = new Set(['com.ge', 'org.ge', 'net.ge', 'edu.ge', 'gov.ge', 'mil.ge', 'pvt.ge', 'co.uk', 'org.uk', 'ac.uk', 'com.au', 'co.nz', 'com.tr', 'com.ua', 'co.il', 'com.br', 'co.jp']);
function registrable(host) {
  const p = host.toLowerCase().replace(/^www\./, '').split('.');
  if (p.length <= 2) return p.join('.');
  return SLD.has(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}
function cookieIssues(list, https) {
  const issues = [];
  for (const c of list || []) {
    const [pair, ...attrs] = c.split(';').map(s => s.trim()), name = pair.split('=')[0], a = attrs.map(s => s.toLowerCase());
    const session = /sess|sid|auth|token|jwt|login|csrf|xsrf/i.test(name), missing = [];
    if (https && !a.includes('secure')) missing.push('Secure');
    if (session && !a.includes('httponly')) missing.push('HttpOnly');
    if (!a.some(x => x.startsWith('samesite='))) missing.push('SameSite');
    if (missing.length) issues.push({ name: name.slice(0, 40), missing, session });
  }
  return { total: (list || []).length, issues };
}
function disclosure(h, body) {
  const out = [];
  if (/\d/.test(h.server || '')) out.push('Server: ' + h.server);
  if (h['x-powered-by']) out.push('X-Powered-By: ' + h['x-powered-by']);
  if (h['x-aspnet-version']) out.push('X-AspNet-Version: ' + h['x-aspnet-version']);
  const g = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i.exec(body || '');
  if (g && /\d/.test(g[1])) out.push('Generator: ' + g[1]);
  return out.map(s => s.slice(0, 80));
}
function findMixed(body) {
  const found = [], re1 = /<(?:script|img|iframe|source|video|audio|embed)\b[^>]*\ssrc=["'](http:\/\/[^"'\s>]+)/gi, re2 = /<link\b[^>]*rel=["']?stylesheet["']?[^>]*href=["'](http:\/\/[^"'\s>]+)/gi;
  for (const re of [re1, re2]) for (let m; (m = re.exec(body || '')) && found.length < 50;) found.push(m[1]);
  return { count: found.length, samples: found.slice(0, 3).map(s => s.slice(0, 80)) };
}
async function checkRedirect(host) {
  try {
    const r = await request('http://' + host + '/', { follow: false, readBody: false, timeout: 6000 });
    const ok = [301, 302, 303, 307, 308].includes(r.status) && /^https:\/\//i.test(new URL(String(r.headers.location || ''), 'http://' + host).href);
    return { ok, status: r.status };
  } catch { return { ok: null }; } // 80-ე პორტი დახურულია ან მიუწვდომელია, ამიტომ დასკვნას არ ვაკეთებთ
}
async function securityTxt(host) {
  try { const r = await request('https://' + host + '/.well-known/security.txt', { timeout: 5000, maxBytes: 20000 });
    return r.status === 200 && /text\/plain/i.test(r.headers['content-type'] || '') && /^\s*Contact:/im.test(r.body); } catch { return false; }
}
async function checkEmail(domain) {
  const txt = async n => { try { return (await withTimeout(dns.resolveTxt(n), 4000)).map(a => a.join('')); } catch { return []; } };
  let mx = [], mxKnown = true;
  try { mx = await withTimeout(dns.resolveMx(domain), 4000); }
  catch (error) { mxKnown = ['ENODATA', 'ENOTFOUND'].includes(error.code); }
  const spfRec = (await txt(domain)).find(s => /^v=spf1\b/i.test(s)), dmRec = (await txt('_dmarc.' + domain)).find(s => /^v=DMARC1\b/i.test(s));
  const SEL = ['default', 'google', 'selector1', 'selector2', 'k1', 'k2', 'mail', 'dkim', 's1', 's2', 'smtp', 'email', 'mandrill', 'mxvault'];
  const dkim = mx.length ? (await Promise.all(SEL.map(async s => (await txt(`${s}._domainkey.${domain}`)).some(r => /v=DKIM1|\bp=/i.test(r)) ? s : null))).filter(Boolean) : [];
  return { applicable: mxKnown ? mx.length > 0 && mx.some(record => record.exchange && record.exchange !== '.') : null, dkim,
    spf: spfRec ? { present: true, policy: /\s-all\b/.test(spfRec) ? 'strict' : /\s~all\b/.test(spfRec) ? 'soft' : 'weak' } : { present: false },
    dmarc: dmRec ? { present: true, policy: ((/(?:^|;)\s*p=(\w+)/i.exec(dmRec) || [])[1] || 'none').toLowerCase() } : { present: false } };
}
async function rdapExpiry(domain) {
  try {
    const r = await request('https://rdap.org/domain/' + domain, { timeout: 7000, maxBytes: 300000, headers: { Accept: 'application/rdap+json' } });
    if (r.status !== 200) return null;
    const ev = (JSON.parse(r.body).events || []).find(e => e.eventAction === 'expiration'); if (!ev) return null;
    return { expires: ev.eventDate, days: Math.floor((new Date(ev.eventDate) - Date.now()) / 864e5) };
  } catch { return null; }
}
// RDAP-ს ყველა ზონა არ უჭერს მხარს (.ge-ს არა), ამიტომ ვცდილობთ WHOIS-ს. თუ ორივე ვერ მუშაობს, შემოწმება გამოტოვებულია
const domainExpiry = async domain => (await rdapExpiry(domain)) || (await whoisExpiry(domain).catch(() => null));

async function performScan(raw) {
  const url = normalizeUrl(raw); await assertPublic(url.hostname);
  const host = url.hostname, apex = registrable(host);
  const response = performPing(url.href, { body: true });
  const sslCheck = response.then(main => {
    const final = new URL(main.response?.url || url.href);
    return final.protocol === 'https:' ? checkSSL(final.hostname) : { ok: false, days: null, error: 'HTTPS is not used' };
  });
  const [main, ssl, redirect, sec, email, dom] = await Promise.all([
    response, sslCheck,
    checkRedirect(host), securityTxt(host), checkEmail(apex).catch(() => null), domainExpiry(apex)
  ]);
  const up = main.up, res = main.response, h = res?.headers || {};
  const https = new URL(res?.url || url.href).protocol === 'https:';
  const headers = Object.entries(HEADERS).map(([k, label]) => ({ label, present: res ? k in h : null }));
  const cookies = up ? cookieIssues([].concat(h['set-cookie'] || []), res.url.startsWith('https:')) : { total: 0, issues: [] };
  const disc = up ? disclosure(h, res.body) : [], mixed = up && https ? findMixed(res.body) : { count: 0, samples: [] };
  const mailOk = e => e?.applicable;
  const checks = [
    { id: 'redirect', ok: redirect.ok }, { id: 'cookies', ok: up ? cookies.issues.length === 0 : null }, { id: 'disclosure', ok: up ? disc.length === 0 : null },
    { id: 'mixed', ok: up && https ? mixed.count === 0 : null },
    { id: 'spf', ok: mailOk(email) ? email.spf.present && email.spf.policy !== 'weak' : null }, { id: 'dmarc', ok: mailOk(email) ? email.dmarc.present && email.dmarc.policy !== 'none' : null },
    { id: 'dkim', ok: mailOk(email) && email.dkim.length ? true : null }, { id: 'securitytxt', ok: sec }, { id: 'domain', ok: dom ? dom.days > 30 : null }
  ].map(check => ({
    ...check, state: check.ok === true ? 'pass' : check.ok === false ? 'fail' :
      (['spf', 'dmarc', 'dkim'].includes(check.id) && email?.applicable === false) ? 'not_applicable' : 'unknown'
  }));
  const pts = {
    ssl: ssl.ok ? (ssl.days > 14 ? 20 : 10) : 0, headers: headers.filter(x => x.present).length * 6,
    redirect: redirect.ok === false ? 0 : 6, cookies: !up ? 0 : cookies.issues.length === 0 ? 6 : cookies.issues.some(i => i.session) ? 1 : 3,
    disclosure: !up || disc.length ? 0 : 4, mixed: !up || mixed.count ? 0 : 4,
    email: !mailOk(email) ? 6 : (email.spf.present ? (email.spf.policy === 'weak' ? 1 : 3) : 0) + (email.dmarc.present ? (email.dmarc.policy === 'none' ? 1 : 3) : 0),
    txt: sec ? 2 : 0, domain: dom && dom.days <= 30 ? 0 : 4
  };
  const unknown = [redirect.ok === null ? 'redirect' : null, !email?.applicable ? 'email' : null, dom ? null : 'domain'].filter(Boolean);
  const weights = { redirect: 6, email: 6, domain: 4 };
  const eligible = Object.keys(pts).filter(key => !unknown.includes(key));
  const possible = 88 - unknown.reduce((sum, key) => sum + weights[key], 0);
  const score = up ? Math.round(100 * eligible.reduce((sum, key) => sum + pts[key], 0) / possible) : null;
  return { url: url.href, finalUrl: res ? publicUrl(res.url) : null, host, up, status: main.status, responseMs: main.ms, ssl, headers, checks,
    details: { redirect, cookies, disclosure: disc, mixed, email, securityTxt: sec, domain: dom, apex },
    score, methodVersion: 2, coverage: { measured: possible, possible: 88 }, scannedAt: new Date().toISOString() };
}
const scan = raw => safeWork(normalizeUrl(raw).hostname, () => performScan(raw));
const ping = (url, options) => safeWork(new URL(url).hostname, () => performPing(url, options));
module.exports = { scan, ping, normalizeUrl, assertPublic, checkSSL, registrable, cookieIssues, disclosure, findMixed, checkEmail, domainExpiry };
