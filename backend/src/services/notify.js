const { db, save, id } = require('../config/db');
const { activePlan } = require('../config/plans');
const { deliverMail } = require('./mail');
const { sendSMS, SMS_ERRORS } = require('./sms');
const { signInExpiresAt, verificationExpiresAt } = require('../helpers/email-expiry');
const { siteActive } = require('../helpers/active-scope');
const { workspaceRole } = require('../helpers/workspace-role');
const { protect, reveal } = require('../helpers/secrets');

const backoff = [60000, 300000, 1800000, 7200000];
const RETENTION = 30 * 86400000;
const findUser = id => db.users.find(user => user.id === id && user.emailVerified && !user.deactivatedAt);

const channelsSupported = ['email', 'sms', 'telegram'];
function enqueue(user, { site, type, message, channels = channelsSupported }) {
  const jobs = [];
  for (const channel of channels) {
    if (!channelsSupported.includes(channel) || user.deactivatedAt || (site && !siteActive(site))) continue;
    if (channel === 'email' && !user.emailVerified) continue;
    if (channel === 'sms' && (!user.phone || user.verifiedPhone !== user.phone || (type !== 'test' && !activePlan(user).sms))) continue;
    if (channel === 'telegram' && (!site?.telegram || !process.env.TELEGRAM_BOT_TOKEN || site.userId !== user.id)) continue;
    const job = { id: id(), userId: user.id, siteId: site?.id, channel, type, message, created: Date.now(), due: Date.now(), state: 'queued', attempts: 0 };
    jobs.push(job);
    db.notifications.push(job);
  }
  return jobs;
}

function enqueueAccountMail(user, type, message, token = null) {
  const now = Date.now();
  const job = {
    id: id(), userId: user.id, channel: 'email', type, accountMail: true, token,
    payload: protect(JSON.stringify(message)), created: now, due: now, state: 'queued', attempts: 0
  };
  db.notifications.push(job);
  return job.id;
}

async function sendAccountMail(job) {
  const user = db.users.find(user => user.id === job.userId);
  if (!user) return false;
  if (job.token) {
    const { kind, hash } = job.token;
    if (kind === 'signin') {
      const attempt = user.emailAttempt;
      if (attempt?.tokenHash !== hash || attempt.version !== (user.tv || 0) || !(signInExpiresAt(attempt) > Date.now())) return false;
    } else {
      const expiresAt = kind === 'reset' ? user.resetExpiresAt : verificationExpiresAt(user);
      if (user[kind + 'Hash'] !== hash || !(expiresAt > Date.now())) return false;
    }
  }
  const message = JSON.parse(reveal(job.payload));
  await deliverMail(user.email, message.subject, message.text, job.id);
  return true;
}

async function send(job) {
  if (job.accountMail) return sendAccountMail(job);
  if (!channelsSupported.includes(job.channel)) return false;
  const user = findUser(job.userId);
  const site = db.sites.find(site => site.id === job.siteId);
  if (!user || (job.siteId && (!site || !siteActive(site)))) return false;
  if (site && site.userId !== user.id && !(site.alertMembers || []).includes(user.id)) return false;
  if (site && site.userId !== user.id && !db.workspaces.some(w => w.id === site.workspaceId && workspaceRole(w, user.id))) return false;
  const message = user.lang === 'ka' ? job.message.ka : job.message.en;
  if (job.channel === 'email') await deliverMail(user.email, message.subject, message.text, job.id);
  if (job.channel === 'sms') {
    if (!user.phone || user.verifiedPhone !== user.phone || (job.type !== 'test' && !activePlan(user).sms)) return false;
    await sendSMS(user.phone, message.subject.slice(0, 160));
  }
  if (job.channel === 'telegram') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!site?.telegram || site.userId !== user.id || !token) return false;
    const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ chat_id: site.telegram, text: message.text, link_preview_options: { is_disabled: true } })
    });
    if (!response.ok || !(await response.json()).ok) throw new Error('TELEGRAM_REJECTED');
  }
  return true;
}

let running = false;
async function processQueue() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const ready = db.notifications.filter(j => j.state === 'queued' && j.due <= now);
    const due = [...ready.filter(job => job.accountMail), ...ready.filter(job => !job.accountMail)].slice(0, 12);
    await Promise.all(due.map(async job => {
      job.attempts++;
      try {
        const accepted = await send(job);
        if (job.state !== 'queued') return;
        job.state = accepted ? 'accepted' : 'cancelled';
        delete job.lastError;
      } catch (error) {
        if (job.state !== 'queued') return;
        job.lastError = job.channel === 'sms' && Object.hasOwn(SMS_ERRORS, error.message) ? error.message
          : error.message === 'MAIL_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'PROVIDER_FAILURE';
        const permanentSmsFailure = job.channel === 'sms' && ['NOT_CONFIGURED', 'SMS_CREDENTIALS', 'SMS_REJECTED'].includes(job.lastError);
        const delay = permanentSmsFailure ? null : backoff[job.attempts - 1];
        if (delay) job.due = Date.now() + delay;
        else job.state = 'failed';
      }
      if (job.state !== 'queued') {
        job.finished = Date.now();
        delete job.message;
        delete job.payload;
        delete job.token;
      }
    }));
    const count = db.notifications.length;
    db.notifications = db.notifications.filter(j => !j.finished || j.finished >= now - RETENTION);
    if (due.length || count !== db.notifications.length) save();
  } finally { running = false; }
}

function wakeQueue() {
  setImmediate(() => processQueue().catch(() => console.error('Notification queue could not be saved')));
}

function notifySite(site, type, message) {
  for (const userId of new Set([site.userId, ...(site.alertMembers || [])])) {
    const user = findUser(userId);
    if (user) enqueue(user, { site, type, message });
  }
}

function cancelAlerts({ userId, sites }) {
  for (const job of db.notifications) {
    if (job.accountMail || job.state !== 'queued' || (job.userId !== userId && !sites.has(job.siteId))) continue;
    job.state = 'cancelled';
    job.finished = Date.now();
    delete job.message;
    delete job.lastError;
  }
}

const deliveryStatus = ({ id, siteId, userId, type, channel, state, attempts, created, due, finished, lastError }) => (
  { id, siteId, userId, type, channel, state, attempts, created, due, finished, lastError }
);
module.exports = { enqueue, enqueueAccountMail, wakeQueue, processQueue, notifySite, deliveryStatus, cancelAlerts, channelsSupported };
