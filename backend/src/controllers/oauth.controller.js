const { UserError } = require('../helpers/errors');
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const { db, save, id } = require('../config/db');
const { FRONTEND_URL, API_BASE, IS_PROD } = require('../config/env');
const { endSession } = require('../helpers/session');
const emailSession = require('../services/email-session');
const { parseCookies } = require('../helpers/cookies');
const mfa = require('../services/mfa');
const { PROVIDERS } = require('../services/oauth');

// პროვაიდერის ფოტოს ვინახავთ ჩვენს სერვერზე, რომ Google-ზე პირდაპირი ბმული არ დაგვჭირდეს
async function fetchAvatar(u, url) {
  try {
    const r = await fetch(url), type = (r.headers.get('content-type') || '').split(';')[0];
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type], buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || !ext || buf.length > 600 * 1024) return url;
    const dir = path.join(__dirname, '../../uploads/avatars'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${u.id}-oauth.${ext}`), buf);
    return `/uploads/avatars/${u.id}-oauth.${ext}?v=${Date.now()}`;
  } catch { return url; }
}
const get = name => { const p = PROVIDERS[name]; if (!p) throw new UserError('Unknown login provider'); return p; };
const callbackUrl = name => `${API_BASE}/api/auth/${name}/callback`;

exports.url = async (req, res) => {
  const name = req.params.provider, p = get(name);
  if (!p.id || !p.secret) throw new UserError(`${name[0].toUpperCase() + name.slice(1)} login is not set up yet (add ${name.toUpperCase()}_CLIENT_ID and ${name.toUpperCase()}_CLIENT_SECRET to .env)`);
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 10 * 60 * 1000 });
  res.json({ url: p.auth + '?' + new URLSearchParams({ client_id: p.id, redirect_uri: callbackUrl(name), response_type: 'code', scope: p.scope, state }) });
};

exports.callback = async (req, res) => {
  const name = req.params.provider;
  const fail = (m, why) => { console.error(`[OAuth ${name}] ${why || m}`); return res.redirect(`${FRONTEND_URL}/auth.html#error=${encodeURIComponent(m)}`); };
  try {
    const p = get(name);
    const cookies = parseCookies(req.headers.cookie);
    if (req.query.error) return fail(`Login was not completed (${req.query.error})`);
    if (!req.query.code || !req.query.state || req.query.state !== cookies.oauth_state)
      return fail('Login failed: your session expired or cookies are blocked. Use http://localhost:5173 and try again.', `state mismatch (cookie present: ${!!cookies.oauth_state}, code present: ${!!req.query.code})`);
    const t = await (await fetch(p.token, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: p.id, client_secret: p.secret, code: req.query.code, redirect_uri: callbackUrl(name), grant_type: 'authorization_code' }) })).json();
    if (!t.access_token) return fail('Login failed, please try again', 'token exchange rejected');
    const pr = await p.profile(t.access_token);
    if (!pr.email || !pr.sub || ['undefined', 'null'].includes(pr.sub)) return fail(`Your ${name} account has no verified email`);
    emailSession.requireMail();
    const email = pr.email.toLowerCase();
    const byProvider = db.users.find(x => x.oauth?.[name] === pr.sub || (name === 'github' && String(x.githubId) === pr.sub));
    let u = byProvider || db.users.find(x => x.email === email);
    if (!u) {
      u = { id: id(), email, pass: null, firstName: pr.first, lastName: pr.last, tv: 0, onboardingPending: true };
      db.users.push(u);
    } else if (!byProvider && !u.emailVerified) {
      u.pass = null;
      u.tv = (u.tv || 0) + 1;
      u.firstName = pr.first;
      u.lastName = pr.last;
      u.onboardingPending = true;
      delete u.verifyHash;
      delete u.verifyExp;
      delete u.verifyIssuedAt;
      delete u.resetHash;
      delete u.resetExp;
      delete u.resetExpiresAt;
    }
    u.emailVerified = true; // პროვაიდერმა ელფოსტა უკვე დაადასტურა
    u.oauth = { ...u.oauth, [name]: pr.sub };
    // ხელით ატვირთულ ფოტოს არასდროს ვცვლით. სხვა შემთხვევაში პროვაიდერის (მაგ. Google-ის) ფოტო გადმოგვაქვს
    const own = u.avatar && u.avatarSource !== 'oauth' && String(u.avatar).startsWith('/uploads/');
    if (pr.avatar && !own) { u.avatar = await fetchAvatar(u, pr.avatar); u.avatarSource = 'oauth'; }
    save();
    res.clearCookie('oauth_state');
    if (u.mfa) {
      endSession(res);
      emailSession.clear(res);
      mfa.challenge(res, u);
      return res.redirect(FRONTEND_URL + '/auth.html#mfa=' + mfa.method(u));
    }
    emailSession.begin(res, u);
    res.redirect(FRONTEND_URL + '/auth.html?confirm');
  } catch (e) { fail(e instanceof UserError ? e.message : 'Login failed, please try again', e.stack || e.message); }
};
