const { db, save, id } = require('../config/db');
const { isAdmin } = require('../config/env');
const { activePlan } = require('../config/plans');
const { hash, verify, burn } = require('../helpers/crypto');
const { endSession } = require('../helpers/session');
const emailSession = require('../services/email-session');
const { UserError } = require('../helpers/errors');
const { validateRegister } = require('../validators/auth.validator');
const mfa = require('../services/mfa');
const { readDraft } = require('../helpers/dashboard-draft');
const { mailConfigured } = require('../services/mail');

exports.register = async (req, res) => {
  const details = validateRegister(req.body);
  emailSession.requireMail();
  const { email, password } = req.body;
  const u = { phone: null, lang: 'en', ...details, id: id(), email: email.toLowerCase(),
    pass: await hash(password), emailVerified: false, tv: 0, onboardingPending: false };
  if (db.users.some(existing => existing.email === u.email)) throw new UserError('This email is already registered', 409);
  db.users.push(u);
  res.status(202).json(emailSession.begin(res, u, { registration: true }));
};
exports.login = async (req, res) => {
  const u = db.users.find(x => x.email === String(req.body.email || '').toLowerCase()), pw = req.body.password;
  const previous = u?.pass;
  const version = u?.tv;
  const ok = u && u.pass ? await verify(pw, u.pass) : (await burn(String(pw || '')), false);
  if (!ok || !db.users.includes(u) || u.tv !== version || u.pass !== previous) throw new UserError('Wrong email or password', 401);
  if (!u.pass.startsWith('scrypt$')) {
    const replacement = await hash(pw);
    if (!db.users.includes(u) || u.tv !== version || u.pass !== previous) throw new UserError('Wrong email or password', 401);
    u.pass = replacement;
    save();
  } // ძველი ჰეში ახალ, უფრო ძლიერ ფორმატზე გადადის
  emailSession.requireMail();
  if (u.mfa) {
    endSession(res);
    emailSession.clear(res);
    mfa.challenge(res, u);
    return res.json({ mfa: true, method: mfa.method(u) });
  }
  res.status(202).json(emailSession.begin(res, u));
};
exports.me = async (req, res) => {
  const u = req.user, g = k => u[k] || '';
  const draft = readDraft(u);
  const pending = Object.keys(draft).length ? draft : null;
  const mail = db.notifications.findLast(job => job.accountMail && job.userId === u.id && job.type === 'verify_account');
  const verificationDelivery = mail?.state === 'queued' && mail.lastError ? 'retrying' : mail?.state || null;
  res.json({ pending, verificationDelivery, mailAvailable: mailConfigured(), onboardingPending: u.onboardingPending === true, email: u.email, firstName: g('firstName'), lastName: g('lastName'), company: g('company'), companyType: g('companyType'), companySize: g('companySize'),
    role: g('role'), phone: g('phone'), avatar: u.avatar || null, provider: Object.keys(u.oauth || {})[0] || (u.githubId ? 'github' : ''),
    mfaEnabled: !!u.mfa, mfaMethod: mfa.method(u), phoneVerified: !!u.phone && u.phone === u.verifiedPhone,
    emailVerified: u.emailVerified === true, hasPassword: !!u.pass, isAdmin: isAdmin(u),
    plan: activePlan(u), planUntil: u.planUntil || null, sites: db.sites.filter(s => s.userId === u.id).map(({ id, url, status, lastCheck }) => ({ id, url, status, lastCheck })) });
};
