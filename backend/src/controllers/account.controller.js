const { db, save } = require('../config/db');
const { FRONTEND_URL } = require('../config/env');
const { hash, verify, sha256, randomToken } = require('../helpers/crypto');
const { startSession, endSession } = require('../helpers/session');
const { CONFIRMATION_MINUTES, CONFIRMATION_MS, verificationExpiresAt } = require('../helpers/email-expiry');
const { UserError } = require('../helpers/errors');
const { mailConfigured } = require('../services/mail');
const { enqueueAccountMail, wakeQueue } = require('../services/notify');
const emailSession = require('../services/email-session');
const { validatePassword } = require('../validators/auth.validator');
const RESET_LINK_MINUTES = 5;

function mail(user, type, en, ka, token) {
  const message = user.lang === 'ka' ? ka : en;
  enqueueAccountMail(user, type, { subject: message.subject, text: message.body }, token);
}

function requireMail() {
  if (!mailConfigured()) throw new UserError('Email delivery is unavailable right now.', 503);
}
const hi = u => (u.firstName ? ' ' + u.firstName : '');

exports.sendVerification = u => {
  if (!mailConfigured()) return false;
  const t = randomToken();
  u.verifyHash = t.hash;
  u.verifyIssuedAt = Date.now();
  u.verifyExp = u.verifyIssuedAt + CONFIRMATION_MS;
  const link = `${FRONTEND_URL}/verify.html#token=${t.raw}`;
  mail(u, 'verify_account', { subject: 'Confirm your email – Secura GE', body: `Hello${hi(u)},\n\nPlease confirm your email address (the link is valid for ${CONFIRMATION_MINUTES} minutes):\n${link}\n\nIf you did not create a Secura GE account, you can ignore this message.` },
    { subject: 'დაადასტურე ელფოსტა – Secura GE', body: `გამარჯობა${hi(u)},\n\nდაადასტურე შენი ელფოსტის მისამართი (ბმული ${CONFIRMATION_MINUTES} წუთი მოქმედებს):\n${link}\n\nთუ Secura GE-ზე ანგარიში შენ არ გაგიხსნია, უბრალოდ უგულებელყავი ეს წერილი.` }, { kind: 'verify', hash: t.hash });
  return true;
};
exports.verify = async (req, res) => {
  const result = emailSession.confirm(req, res);
  if (result) return res.json(result);
  const t = String(req.body.token || ''), h = sha256(t);
  const u = t && db.users.find(x => x.verifyHash && x.verifyHash === h && verificationExpiresAt(x) > Date.now());
  if (!u) throw new UserError('This confirmation link is invalid or has expired.');
  u.emailVerified = true; delete u.verifyHash; delete u.verifyExp; delete u.verifyIssuedAt; save(); res.json({ ok: true });
};
exports.resend = async (req, res) => {
  if (req.user.emailVerified) return res.json({ queued: false });
  requireMail();
  exports.sendVerification(req.user);
  save();
  wakeQueue();
  res.status(202).json({ queued: true });
};

exports.forgot = async (req, res) => {
  requireMail();
  const u = db.users.find(x => x.email === String(req.body.email || '').toLowerCase().trim());
  if (u) {
    const t = randomToken();
    u.resetHash = t.hash;
    u.resetExpiresAt = Date.now() + RESET_LINK_MINUTES * 60_000;
    delete u.resetExp;
    const link = `${FRONTEND_URL}/reset.html#token=${t.raw}`;
    mail(u, 'reset_password', { subject: 'Reset your password – Secura GE', body: `Hello${hi(u)},\n\nSomeone asked to reset the password of your Secura GE account. Choose a new password here (the link is valid for ${RESET_LINK_MINUTES} minutes):\n${link}\n\nIf this was not you, ignore this message. Your password stays the same.` },
      { subject: 'პაროლის აღდგენა – Secura GE', body: `გამარჯობა${hi(u)},\n\nვიღაცამ მოითხოვა შენი Secura GE ანგარიშის პაროლის აღდგენა. აირჩიე ახალი პაროლი აქ (ბმული ${RESET_LINK_MINUTES} წუთი მოქმედებს):\n${link}\n\nთუ ეს შენ არ იყავი, უგულებელყავი ეს წერილი. პაროლი უცვლელი დარჩება.` }, { kind: 'reset', hash: t.hash });
    save();
    wakeQueue();
  }
  res.status(202).json({ ok: true }); // პასუხი ყოველთვის ერთნაირია, რომ ელფოსტის არსებობა არ გამოჩნდეს
};
const changed = u => mailConfigured() && mail(u, 'password_changed', { subject: 'Your password was changed – Secura GE', body: `Hello${hi(u)},\n\nThe password of your Secura GE account was just changed. If this was not you, reset it immediately using "Forgot password" on the login page.` },
  { subject: 'პაროლი შეიცვალა – Secura GE', body: `გამარჯობა${hi(u)},\n\nშენი Secura GE ანგარიშის პაროლი ახლახან შეიცვალა. თუ ეს შენ არ იყავი, დაუყოვნებლივ აღადგინე შესვლის გვერდზე „დაგავიწყდა პაროლი?“-ს გამოყენებით.` });
exports.reset = async (req, res) => {
  const t = String(req.body.token || ''), h = sha256(t);
  const u = t && db.users.find(x => x.resetHash && x.resetHash === h && x.resetExpiresAt > Date.now());
  if (!u) throw new UserError('This reset link is invalid or has expired.');
  validatePassword(req.body.password, u.email);
  const replacement = await hash(req.body.password);
  if (!db.users.includes(u) || u.resetHash !== h || !(u.resetExpiresAt > Date.now())) throw new UserError('This reset link is invalid or has expired.');
  delete u.mfaChallenge;
  u.pass = replacement; u.tv = (u.tv || 0) + 1; u.emailVerified = true; // ყველა ძველი სესია წყდება
  delete u.resetHash; delete u.resetExpiresAt; delete u.verifyHash; delete u.verifyExp; delete u.verifyIssuedAt;
  changed(u);
  save();
  wakeQueue();
  res.json({ ok: true });
};
exports.changePassword = async (req, res) => {
  const u = req.user, { current, next } = req.body;
  const previous = u.pass, sessionVersion = u.tv || 0;
  if (previous && !(await verify(current, previous))) throw new UserError('Current password is wrong');
  validatePassword(next, u.email);
  const replacement = await hash(next);
  if (!db.users.includes(u) || u.pass !== previous || (u.tv || 0) !== sessionVersion)
    throw new UserError('Your session changed. Sign in and try again.', 409);
  u.pass = replacement;
  delete u.mfaChallenge;
  delete u.resetHash;
  delete u.resetExp;
  delete u.resetExpiresAt;
  u.tv = sessionVersion + 1;
  changed(u);
  save();
  wakeQueue();
  startSession(res, u); res.json({ ok: true }); // ამ სესიას ახალ cookie-ს ვაძლევთ, დანარჩენი მოწყობილობები გამოდიან
};
exports.logoutAll = async (req, res) => { req.user.tv = (req.user.tv || 0) + 1; save(); endSession(res); res.json({ ok: true }); };
