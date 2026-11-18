const { TOTP, Secret } = require('otpauth');
const { JWT_SECRET, IS_PROD } = require('../config/env');
const { sha256 } = require('../helpers/crypto');
const { protect, reveal } = require('../helpers/secrets');
const { parseCookies } = require('../helpers/cookies');
const { db, id, save } = require('../config/db');
const jwt = require('jsonwebtoken');
const NAME = IS_PROD ? '__Host-sg_mfa' : 'sg_mfa';
const cookie = { httpOnly: true, secure: IS_PROD, sameSite: 'lax', path: '/' };

const totp = (user, secret) => new TOTP({ issuer: 'Secura GE', label: user.email, secret: Secret.fromBase32(secret) });
function setup(user) {
  const secret = new Secret({ size: 20 }).base32;
  user.mfaSetup = { secret: protect(secret), expires: Date.now() + 600000 };
  save();
  return { secret, uri: totp(user, secret).toString() };
}
function step(user, secret, code) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const now = Date.now();
  const offset = totp(user, reveal(secret)).validate({ token: String(code), window: 1, timestamp: now });
  return offset === null ? null : Math.floor(now / 30000) + offset;
}
function enable(user, code) {
  const pending = user.mfaSetup;
  if (!pending || pending.expires < Date.now()) return null;
  const last = step(user, pending.secret, code);
  if (last == null) return null;
  return configure(user, { secret: pending.secret, last });
}
function configure(user, method) {
  const recovery = Array.from({ length: 8 }, () => id(10));
  user.mfa = { ...method, recovery: recovery.map(sha256) };
  user.tv = (user.tv || 0) + 1;
  delete user.mfaSetup;
  delete user.mfaChallenge;
  delete user.passkeySetup;
  delete user.passkeyAction;
  save();
  return recovery;
}
function method(user) {
  if (!user.mfa) return null;
  return user.mfa.credential ? 'passkey' : 'totp';
}
function check(user, code) {
  if (!user.mfa) return false;
  const hash = sha256(String(code || '').trim().toLowerCase());
  if (user.mfa.recovery.includes(hash)) {
    user.mfa.recovery = user.mfa.recovery.filter(value => value !== hash);
  } else {
    if (!user.mfa.secret) return false;
    const last = step(user, user.mfa.secret, code);
    if (last == null || last <= user.mfa.last) return false;
    user.mfa.last = last;
  }
  save();
  return true;
}
function challenge(res, user) {
  const nonce = id(16);
  user.mfaChallenge = { nonce: sha256(nonce), expires: Date.now() + 300000, version: user.tv || 0 };
  save();
  res.cookie(NAME, jwt.sign({ purpose: 'mfa', userId: user.id, nonce }, JWT_SECRET, { expiresIn: 300, algorithm: 'HS256' }), {
    ...cookie, maxAge: 300000
  });
}
function pending(req) {
  try {
    const token = jwt.verify(parseCookies(req.headers.cookie)[NAME], JWT_SECRET, { algorithms: ['HS256'] });
    if (token.purpose !== 'mfa') return null;
    return db.users.find(u => u.id === token.userId && u.mfa &&
      u.mfaChallenge?.version === (u.tv || 0) && u.mfaChallenge.expires >= Date.now() && u.mfaChallenge.nonce === sha256(token.nonce)) || null;
  } catch { return null; }
}
function finish(res, user) {
  delete user.mfaChallenge;
  save();
  res.clearCookie(NAME, cookie);
}
module.exports = { setup, enable, configure, method, check, challenge, pending, finish };
