const { createHmac, randomInt, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { UserError } = require('../helpers/errors');
const { verify } = require('../helpers/crypto');
const { startSession, endSession } = require('../helpers/session');
const { JWT_SECRET, isAdmin } = require('../config/env');
const { db, save } = require('../config/db');
const { sendSMS, normPhone, SMS_ERRORS } = require('../services/sms');
const { workspaceRole } = require('../helpers/workspace-role');
const mfa = require('../services/mfa');
const passkey = require('../services/passkey');
const emailSession = require('../services/email-session');
const { cancelAlerts } = require('../services/notify');

const unmet = () => new UserError('Invalid or expired security code', 401);
async function currentPassword(user, password) {
  if (user.pass && !(await verify(password, user.pass))) throw new UserError('Current password is wrong', 403);
}

exports.beginMfa = async (req, res) => {
  if (!req.user.emailVerified || req.user.mfa) throw new UserError('MFA setup is unavailable', 403);
  await currentPassword(req.user, req.body.password);
  if (req.user.mfa) throw new UserError('MFA setup is unavailable', 403);
  res.json(mfa.setup(req.user));
};
exports.enableMfa = async (req, res) => {
  if (req.user.mfa) throw new UserError('MFA is already configured', 409);
  const recovery = mfa.enable(req.user, req.body.code);
  if (!recovery) throw unmet();
  startSession(res, req.user);
  res.json({ recovery, isAdmin: isAdmin(req.user) });
};
exports.completeMfa = async (req, res) => {
  const user = mfa.pending(req);
  if (!user) throw unmet();
  emailSession.requireMail();
  if (!mfa.check(user, req.body.code)) throw unmet();
  mfa.finish(res, user);
  res.status(202).json(emailSession.begin(res, user));
};
exports.beginPasskey = async (req, res) => {
  const user = req.user, { password, code } = req.body;
  if (!user.emailVerified || mfa.method(user) === 'passkey') throw new UserError('Passkey setup is unavailable.', 403);
  const existing = user.mfa, version = user.tv;
  await currentPassword(user, password);
  const options = await passkey.registrationOptions(user);
  if (user.tv !== version || user.mfa !== existing) throw unmet();
  if (existing && !mfa.check(user, code)) throw unmet();
  passkey.beginRegistration(user, options);
  res.json(options);
};

exports.enablePasskey = async (req, res) => {
  const user = req.user;
  if (!user.emailVerified || mfa.method(user) === 'passkey') throw new UserError('Passkey setup is unavailable.', 403);
  const credential = await passkey.register(user, req.body.response);
  if (!credential) throw new UserError('Passkey setup could not be verified. Start again.', 401);
  const recovery = mfa.configure(user, { credential });
  startSession(res, user);
  res.json({ recovery });
};

exports.loginPasskeyOptions = async (req, res) => {
  const user = mfa.pending(req);
  if (!user) throw unmet();
  const options = await passkey.beginAssertion(user, 'login', user.mfaChallenge);
  if (!options) throw unmet();
  res.json(options);
};

exports.completePasskey = async (req, res) => {
  const user = mfa.pending(req), login = user?.mfaChallenge;
  if (!user) throw unmet();
  emailSession.requireMail();
  if (!(await passkey.verifyAssertion(user, req.body.response, 'login', login)) || mfa.pending(req) !== user) throw unmet();
  mfa.finish(res, user);
  res.status(202).json(emailSession.begin(res, user));
};

exports.accountPasskeyOptions = async (req, res) => {
  const { purpose } = req.body;
  if (!['disable', 'delete', 'deactivate'].includes(purpose) || (purpose === 'disable' && isAdmin(req.user))) throw unmet();
  const options = await passkey.beginAssertion(req.user, purpose);
  if (!options) throw unmet();
  res.json(options);
};

async function confirmMfa(user, body, purpose) {
  return body.response ? passkey.verifyAssertion(user, body.response, purpose) : mfa.check(user, body.code);
}

exports.disableMfa = async (req, res) => {
  if (isAdmin(req.user)) throw new UserError('Administrators must keep MFA enabled', 403);
  await currentPassword(req.user, req.body.password);
  if (!(await confirmMfa(req.user, req.body, 'disable'))) throw unmet();
  delete req.user.mfa;
  delete req.user.mfaChallenge;
  delete req.user.passkeyAction;
  req.user.tv = (req.user.tv || 0) + 1;
  save();
  startSession(res, req.user);
  res.json({ ok: true });
};

const phoneCode = (user, phone, code) => createHmac('sha256', JWT_SECRET)
  .update(user.id + ':' + phone + ':' + code).digest('hex');
exports.sendPhone = async (req, res) => {
  const user = req.user;
  if (!user.emailVerified) throw new UserError('Please confirm your email first. Check your inbox for the confirmation link.', 403);
  const phone = normPhone(req.body.phone);
  if (!phone || user.phone !== phone) throw new UserError('Save your mobile number before verifying it');
  const code = String(randomInt(100000, 1000000));
  const pending = { hash: phoneCode(user, phone, code), phone, expires: Date.now() + 300000, attempts: 0 };
  user.phoneChallenge = pending;
  save();
  try { await sendSMS(phone, 'Secura GE: ' + code); } catch (error) {
    if (user.phoneChallenge === pending) { delete user.phoneChallenge; save(); }
    throw new UserError(SMS_ERRORS[error.message] || SMS_ERRORS.SMS_UNAVAILABLE, 503);
  }
  res.json({ ok: true });
};
exports.verifyPhone = async (req, res) => {
  const user = req.user;
  const pending = user.phoneChallenge;
  if (!pending || pending.phone !== user.phone || pending.expires < Date.now() || pending.attempts >= 5) throw unmet();
  const actual = Buffer.from(phoneCode(user, pending.phone, String(req.body.code || '')));
  pending.attempts++;
  const valid = timingSafeEqual(actual, Buffer.from(pending.hash));
  if (valid) {
    user.verifiedPhone = pending.phone;
    delete user.phoneChallenge;
  }
  save();
  if (!valid) throw unmet();
  res.json({ ok: true });
};

exports.exportData = async (req, res) => {
  const { id, email, firstName, lastName, phone, company, companyType, companySize, role, lang, plan, planUntil, emailVerified } = req.user;
  const profile = { id, email, firstName, lastName, phone, company, companyType, companySize, role, lang, plan, planUntil, emailVerified };
  const sites = db.sites.filter(site => site.userId === id).map(({ slack, verification, telegram, ...site }) => site);
  const orders = db.orders.filter(order => order.userId === id).map(({ id, type, amount, currency, createdAt, paid }) => (
    { id, type, amount, currency, createdAt, paid }
  ));
  const reviews = db.reviews.filter(review => review.userId === id);
  const workspaces = db.workspaces.filter(team => team.userId === id || team.members.includes(id))
    .map(team => ({ id: team.id, name: team.name, role: workspaceRole(team, id) }));
  const notifications = db.notifications.filter(job => job.userId === id)
    .map(({ id, siteId, state, type, channel, attempts, created, finished }) => ({
      id, siteId, state, type, channel, attempts, created, finished
    }));
  res.attachment('secura-account.json').json({ profile, sites, orders, reviews, workspaces, notifications });
};
function deleteData(user) {
  const owned = new Set(db.sites.filter(site => site.userId === user.id).map(site => site.id));
  const teams = new Set(db.workspaces.filter(team => team.userId === user.id).map(team => team.id));
  db.users = db.users.filter(item => item !== user);
  db.sites = db.sites.filter(site => !owned.has(site.id));
  db.workspaces = db.workspaces.filter(team => !teams.has(team.id));
  db.reviews = db.reviews.filter(review => review.userId !== user.id);
  db.shares = db.shares.filter(share => !owned.has(share.siteId));
  db.notifications = db.notifications.filter(job => job.userId !== user.id && !owned.has(job.siteId));
  for (const order of db.orders.filter(order => order.userId === user.id)) delete order.userId;
  for (const team of db.workspaces) {
    team.members = team.members.filter(id => id !== user.id);
    if (team.memberRoles) delete team.memberRoles[user.id];
    team.invites = team.invites.filter(invite => invite.email !== user.email);
  }
  for (const site of db.sites) site.alertMembers = (site.alertMembers || []).filter(id => id !== user.id);
  save();
  const base = path.join(__dirname, '../../uploads/avatars');
  for (const suffix of ['.jpg', '-oauth.jpg', '-oauth.png', '-oauth.webp']) {
    try { fs.rmSync(path.join(base, user.id + suffix), { force: true }); }
    catch { console.error('Account avatar cleanup failed'); }
  }
}
exports.deleteData = deleteData;
exports.removeAccount = async (req, res) => {
  const user = req.user;
  if (String(req.body.email || '').trim().toLowerCase() !== user.email) throw new UserError('Enter your account email to confirm deletion');
  await currentPassword(user, req.body.password);
  if (user.mfa && !(await confirmMfa(user, req.body, 'delete'))) throw unmet();
  deleteData(user);
  endSession(res);
  res.json({ ok: true });
};

exports.deactivateAccount = async (req, res) => {
  const user = req.user;
  const version = user.tv;
  await currentPassword(user, req.body.password);
  if (user.mfa && !(await confirmMfa(user, req.body, 'deactivate'))) throw unmet();
  if (!db.users.includes(user) || user.tv !== version || user.deactivatedAt) throw unmet();
  user.deactivatedAt = Date.now();
  cancelAlerts({ userId: user.id, sites: new Set(db.sites.filter(site => site.userId === user.id).map(site => site.id)) });
  user.tv = (user.tv || 0) + 1;
  delete user.emailAttempt;
  delete user.mfaChallenge;
  save();
  emailSession.clear(res);
  endSession(res);
  res.json({ ok: true });
};
