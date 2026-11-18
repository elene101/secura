// უსაფრთხო გამავალი მოთხოვნები (SSRF-ისგან დაცვა): შიდა მისამართები იბლოკება როგორც DNS-ის, ისე ყოველი გადამისამართების დონეზე
const dns = require('dns'), net = require('net'), http = require('http'), https = require('https');
const { ALLOW_PRIVATE_TARGETS } = require('../config/env');
const { UserError } = require('../helpers/errors');
const MSG = 'Scanning local addresses is not allowed';

const BL = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BL.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]]) BL.addSubnet(a, p, 'ipv6');

function isBlockedIp(ip) {
  if (ALLOW_PRIVATE_TARGETS) return false;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); if (m) ip = m[1];
  const v = net.isIP(ip); if (!v) return true;
  return BL.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}
// კავშირის დამყარების მომენტში ხელახლა ამოწმებს მისამართს (DNS rebinding-ის წინააღმდეგ)
function safeLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some(a => isBlockedIp(a.address))) return cb(new UserError(MSG));
    options.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
  });
}
function assertSafeUrl(url) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new UserError('Invalid address');
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (!ALLOW_PRIVATE_TARGETS && !['80', '443'].includes(port)) throw new UserError('Invalid address');
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h.length > 253) throw new UserError('Invalid address');
  if (net.isIP(h)) { if (isBlockedIp(h)) throw new UserError(MSG); return; }
  if (!ALLOW_PRIVATE_TARGETS && (!h.includes('.') || /\.(local|localhost|internal|lan|home|corp|intranet)$/.test(h))) throw new UserError(MSG);
}

function once(url, { method, timeout, maxBytes, readBody, insecure, headers, signal }) {
  return new Promise((resolve, reject) => {
    try { assertSafeUrl(url); } catch (e) { return reject(e); }
    const t0 = Date.now(), lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method, lookup: safeLookup, timeout, signal, rejectUnauthorized: !insecure,
      headers: { 'User-Agent': 'SecuraGE-Scanner/1.0', Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', 'Accept-Encoding': 'identity', ...headers } }, res => {
      const ms = Date.now() - t0, type = String(res.headers['content-type'] || '');
      res.on('error', () => {});
      if (!readBody || method === 'HEAD' || !/text|json|xml/i.test(type)) { res.destroy(); return resolve({ status: res.statusCode, headers: res.headers, body: '', ms }); }
      const chunks = []; let n = 0;
      res.on('data', c => { n += c.length; chunks.push(c); if (n > maxBytes) res.destroy(); });
      res.on('close', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8').slice(0, maxBytes), ms }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}
const TLS_ERR = /^(CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO|ERR_TLS_CERT)/;
// გადამისამართებს ხელით მივყვებით და ყოველ ბმულს თავიდან ვამოწმებთ
async function request(input, o = {}) {
  const opts = { method: 'GET', timeout: 10000, maxBytes: 300000, readBody: true, follow: true, maxRedirects: 5, ...o };
  opts.signal ||= AbortSignal.timeout(opts.timeout);
  const tlsFailures = new Set();
  let url = new URL(input), insecure = false, redirects = 0; const hops = [];
  for (;;) {
    let r;
    try { r = await once(url, { ...opts, insecure }); }
    catch (e) { if (!insecure && url.protocol === 'https:' && TLS_ERR.test(e.code || '')) { insecure = true; tlsFailures.add(url.origin); continue; } throw e; }
    if (opts.follow && [301, 302, 303, 307, 308].includes(r.status) && r.headers.location && redirects < opts.maxRedirects) {
      hops.push(url.href); url = new URL(r.headers.location, url); insecure = false; redirects++; continue;
    }
    return { ...r, url: url.href, hops, tlsError: tlsFailures.size > 0 };
  }
}
module.exports = { request, safeLookup, isBlockedIp, assertSafeUrl };
