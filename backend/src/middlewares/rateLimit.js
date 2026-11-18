// მეხსიერებაში მომუშავე შემზღუდველი (ერთ სერვერზე საკმარისია; მრავალ სერვერზე გამოიყენე Redis)
const buckets = new Map();
const limiter = ({ name, max, windowMs, key = req => req.ip }) => (req, res, next) => {
  const k = name + ':' + key(req), now = Date.now(), arr = (buckets.get(k) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { res.set('Retry-After', String(Math.ceil(windowMs / 1000))); return res.status(429).json({ error: 'Rate limit reached, try again later' }); }
  arr.push(now); buckets.set(k, arr); next();
};
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some(t => now - t < 3600e3)) buckets.delete(k); }, 10 * 60e3).unref();
const email = req => String(req.body?.email || '').toLowerCase().slice(0, 200);
const H = 3600e3, M15 = 15 * 60e3;
module.exports = {
  limiter,
  api: limiter({ name: 'api', max: 600, windowMs: M15 }),
  scan: limiter({ name: 'scan', max: 10, windowMs: H }),
  register: limiter({ name: 'register', max: 5, windowMs: H }),
  loginIp: limiter({ name: 'login-ip', max: 15, windowMs: M15 }),
  loginEmail: limiter({ name: 'login-email', max: 8, windowMs: M15, key: email }),
  forgotIp: limiter({ name: 'forgot-ip', max: 5, windowMs: H }),
  forgotEmail: limiter({ name: 'forgot-email', max: 3, windowMs: H, key: email }),
  sensitive: limiter({ name: 'sensitive', max: 20, windowMs: H }),
  resend: limiter({ name: 'resend', max: 3, windowMs: H, key: req => req.user.id }),
  password: limiter({ name: 'password', max: 10, windowMs: H, key: req => req.user.id }),
  orders: limiter({ name: 'orders', max: 20, windowMs: H }),
  review: limiter({ name: 'review', max: 10, windowMs: H })
};
