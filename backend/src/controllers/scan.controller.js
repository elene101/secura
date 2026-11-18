const { scan, normalizeUrl } = require('../services/scanner');
const { UserError } = require('../helpers/errors');
const hits = new Map(); let inflight = 0;
// ერთ საიტს საათში 20-ჯერზე მეტს ვერავინ დაასკანერებს (რომ ჩვენი სერვისი სხვისი შეწუხებისთვის არ გამოიყენონ)
function hostGuard(host) {
  const now = Date.now();
  if (hits.size >= 1000) {
    for (const [key, times] of hits) if (times.at(-1) < now - 3600e3) hits.delete(key);
    if (!hits.has(host) && hits.size >= 1000) throw new UserError('Scanner is busy. Try again shortly.', 503);
  }
  const arr = (hits.get(host) || []).filter(t => now - t < 3600e3);
  if (arr.length >= 20) throw new UserError('Scanning this site too often, try again later', 429);
  arr.push(now); hits.set(host, arr);
}
exports.scan = async (req, res) => {
  const url = normalizeUrl(req.body.url); hostGuard(url.hostname.toLowerCase());
  if (inflight >= 10) throw new UserError('Rate limit reached, try again later', 429);
  inflight++; try { res.json(await scan(url.href)); } finally { inflight--; }
};
