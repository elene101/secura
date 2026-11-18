const { db } = require('../config/db');
const { normPhone } = require('./../services/sms');
const { UserError } = require('../helpers/errors');
// ეს სიები უნდა ემთხვეოდეს frontend/src/options.js-ს
const LISTS = {
  companyType: ['Individual', 'Online store', 'Agency / studio', 'Freelancer', 'Startup', 'Enterprise', 'Other'],
  companySize: ['Just me', '2-10', '11-50', '51-200', '200+'],
  role: ['Owner / founder', 'Developer', 'IT / security', 'Marketing', 'Other']
};
const PHONE_MSG = 'Enter a mobile number with country code (e.g. +44 7700 900123) or a Georgian number (599123456)';
const COMMON = new Set(['password', 'password1', 'password12', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'qwerty12345', '1q2w3e4r5t', 'iloveyou12', 'admin12345', 'welcome123', 'letmein123', 'abc1234567', '0123456789', 'secura1234']);

exports.validatePassword = (pw, email) => {
  const p = typeof pw === 'string' ? pw : '';
  if ([...p].length < 10 || p.length > 128 || !/\p{Lu}/u.test(p) || !/[\p{P}\p{S}]/u.test(p))
    throw new UserError('Use 10–128 characters, an uppercase letter and a special character.');
  if (COMMON.has(p.toLowerCase()) || p.toLowerCase() === String(email || '').toLowerCase() || new Set(p).size < 4)
    throw new UserError('Choose a less predictable password.');
};
exports.validateRegister = body => {
  const { email, password } = body;
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('Check your email address');
  exports.validatePassword(password, email);
  if (db.users.some(u => u.email === email.toLowerCase())) throw new UserError('This email is already registered');
  return exports.validateOnboarding(body);
};
exports.validateProfile = b => {
  const out = {}, s = (v, n) => String(v ?? '').trim().slice(0, n);
  for (const k of ['firstName', 'lastName', 'company']) if (k in b) out[k] = s(b[k], 60);
  if ('firstName' in out && !out.firstName) throw new UserError('First name cannot be empty');
  for (const k of Object.keys(LISTS)) if (k in b) { if (b[k] && !LISTS[k].includes(b[k])) throw new UserError('Invalid ' + k); out[k] = b[k] || ''; }
  if ('phone' in b) { out.phone = normPhone(b.phone); if (b.phone && !out.phone) throw new UserError(PHONE_MSG); }
  if ('lang' in b) { if (!['en', 'ka'].includes(b.lang)) throw new UserError('Invalid language'); out.lang = b.lang; }
  return out;
};

exports.validateOnboarding = body => {
  const clean = exports.validateProfile(body);
  for (const [field, message] of [
    ['firstName', 'Enter your first name'], ['lastName', 'Enter your last name'],
    ['companyType', 'Choose your company type'], ['role', 'Choose your role']
  ]) {
    if (typeof body[field] !== 'string' || !clean[field]) throw new UserError(message);
  }
  const personal = ['Individual', 'Freelancer'].includes(clean.companyType);
  if (!personal && (typeof body.company !== 'string' || !clean.company)) throw new UserError('Enter your company name');
  if (!personal && !clean.companySize) throw new UserError('Choose your company size');
  if (personal && !clean.companySize) clean.companySize = 'Just me';
  return clean;
};
