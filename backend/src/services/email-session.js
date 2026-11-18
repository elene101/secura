const { FRONTEND_URL, IS_PROD } = require('../config/env');
const { db, save } = require('../config/db');
const { UserError } = require('../helpers/errors');
const { randomToken, sha256 } = require('../helpers/crypto');
const { CONFIRMATION_MINUTES, CONFIRMATION_MS, signInExpiresAt } = require('../helpers/email-expiry');
const { parseCookies } = require('../helpers/cookies');
const { startSession, endSession } = require('../helpers/session');
const { mailConfigured } = require('./mail');
const { enqueueAccountMail, wakeQueue } = require('./notify');

const cookieName = IS_PROD ? '__Host-sg_email' : 'sg_email';
const cookie = { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/' };
const valid = (attempt, user) => attempt && signInExpiresAt(attempt) > Date.now() && attempt.version === (user.tv || 0);
const invalidLink = () => new UserError('This confirmation link is invalid or has expired.');
function requireMail() {
  if (!mailConfigured()) throw new UserError('Email delivery is unavailable right now.', 503);
}

function queue(user, attempt) {
  const token = randomToken();
  attempt.tokenHash = token.hash;
  attempt.sent = Date.now();
  attempt.expires = attempt.sent + CONFIRMATION_MS;
  const link = FRONTEND_URL.replace(/\/$/, '') + '/verify.html#token=' + token.raw;
  const ka = user.lang === 'ka';
  const action = attempt.reactivation ? (ka ? 'ანგარიშის ხელახლა გააქტიურება' : 'Reactivate your account')
    : attempt.registration ? (ka ? 'დაადასტურე ელფოსტის მისამართი' : 'Confirm your email address')
      : (ka ? 'დაადასტურე შესვლა' : 'Confirm your sign-in');
  attempt.job = enqueueAccountMail(user, 'confirm_sign_in', {
    subject: action + ' – Secura GE',
    text: ka ? action + ' (' + CONFIRMATION_MINUTES + ' წუთში იწურება).\n\n' + link + '\n\nთუ მოთხოვნა შენ არ გაგიგზავნია, წერილი უგულებელყავი.'
      : action + ' within ' + CONFIRMATION_MINUTES + ' minutes.\n\n' + link + '\n\nIf you did not request this, ignore this email.'
  }, { kind: 'signin', hash: token.hash });
  save();
  wakeQueue();
}

function begin(res, user, { registration = false } = {}) {
  requireMail();
  const browser = randomToken();
  const attempt = { browserHash: browser.hash, version: user.tv || 0,
    registration, reactivation: !!user.deactivatedAt };
  user.emailAttempt = attempt;
  queue(user, attempt);
  endSession(res);
  res.cookie(cookieName, browser.raw, { ...cookie, maxAge: CONFIRMATION_MS });
  return { emailConfirmation: true };
}

function pending(req) {
  const browser = parseCookies(req.headers.cookie)[cookieName];
  if (typeof browser !== 'string' || !/^[a-f0-9]{64}$/.test(browser)) return null;
  const hash = sha256(browser);
  return db.users.find(user => user.emailAttempt?.browserHash === hash && valid(user.emailAttempt, user)) || null;
}

function complete(req, res) {
  const user = pending(req);
  if (!user?.emailAttempt.confirmed) return false;
  if (user.emailAttempt.reactivation) {
    delete user.deactivatedAt;
    for (const site of db.sites.filter(site => site.userId === user.id && !site.paused)) site.nextCheck = Date.now();
  }
  delete user.emailAttempt;
  save();
  clear(res);
  startSession(res, user);
  return true;
}
function confirm(req, res) {
  const token = req.body?.token;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalidLink();
  const hash = sha256(token);
  const user = db.users.find(user => user.emailAttempt?.tokenHash === hash && valid(user.emailAttempt, user));
  if (!user) return null;
  delete user.emailAttempt.tokenHash;
  user.emailAttempt.confirmed = true;
  user.emailVerified = true;
  delete user.verifyHash;
  delete user.verifyExp;
  delete user.verifyIssuedAt;
  save();
  return { ok: true, signedIn: pending(req) === user && complete(req, res), pending: true };
}
function clear(res) {
  res.clearCookie(cookieName, cookie);
}

async function status(req, res) {
  const user = pending(req);
  if (!user) return res.json({ pending: false });
  if (complete(req, res)) return res.json({ signedIn: true });
  const delivery = db.notifications.find(job => job.id === user.emailAttempt.job);
  res.json({ pending: true, reactivation: user.emailAttempt.reactivation,
    retrying: delivery?.state === 'queued' && !!delivery.lastError, failed: delivery?.state === 'failed' });
}

async function resend(req, res) {
  const user = pending(req);
  if (!user || user.emailAttempt.confirmed) throw invalidLink();
  if (Date.now() - user.emailAttempt.sent < 60_000) throw new UserError('Wait one minute before resending the email.', 429);
  requireMail();
  queue(user, user.emailAttempt);
  const browser = parseCookies(req.headers.cookie)[cookieName];
  res.cookie(cookieName, browser, { ...cookie, maxAge: CONFIRMATION_MS });
  res.status(202).json({ queued: true });
}

module.exports = { begin, requireMail, confirm, status, resend, clear };
