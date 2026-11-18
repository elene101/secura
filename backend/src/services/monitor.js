const fs = require('node:fs');
const path = require('node:path');
const cron = require('node-cron');
const { db, save, backupTo, backupExt, id } = require('../config/db');
const { ping, scan } = require('./scanner');
const { publicUrl } = require('./scan-work');
const { record, pruneHistory } = require('./stats');
const { notifySite, processQueue } = require('./notify');
const { siteActive } = require('../helpers/active-scope');
const { confirmFromPeer } = require('./monitor-peer');

const MINUTE = 60000;
const checks = new Set();
const scans = new Set();
const live = site => db.sites.includes(site) && !site.paused && siteActive(site);
const interval = site => (site.verifiedAt ? (site.interval || 30) : 30) * MINUTE;
const inMaintenance = site => site.maintenanceStart <= Date.now() && site.maintenanceEnd > Date.now();
const system = () => db.system.find(x => x.id === 'monitor');
const formatDate = date => new Date(date).toISOString();

function message(site, en, ka, details = '') {
  const label = publicUrl(site.url);
  const subject = text => 'Secura GE · ' + text + ' · ' + label;
  const text = title => subject(title) + '\n' + formatDate(Date.now()) + (details ? '\n' + details : '');
  return { en: { subject: subject(en), text: text(en) }, ka: { subject: subject(ka), text: text(ka) } };
}

function applyIncident(site, result, now) {
  const incidents = site.incidents ||= [];
  const open = incidents.at(-1);
  if (inMaintenance(site)) return;
  if (!result.up && (!open || open.end)) {
    incidents.push({ id: id(), start: now, reason: result.reason, status: result.status, confirmation: result.confirmation || 'primary' });
    if (incidents.length > 100) incidents.shift();
    notifySite(site, 'down', message(site, 'Site unavailable', 'საიტი მიუწვდომელია', result.reason));
  }
  if (result.up && open && !open.end) {
    open.end = now;
    notifySite(site, 'recovery', message(site, 'Site recovered', 'საიტი აღდგა'));
  }
}

async function checkOne(site, { scheduled = false } = {}) {
  if (!live(site) || checks.has(site.id)) return false;
  checks.add(site.id);
  const now = Date.now();
  const options = { expectedStatus: site.expectedStatus, expectedText: site.expectedText, body: !!site.expectedText };
  try {
    let result = await ping(site.url, options);
    if (!live(site)) return false;
    const currentlyDown = site.incidents?.at(-1) && !site.incidents.at(-1).end;
    if (!result.up && !currentlyDown && !inMaintenance(site)) {
      const retry = await ping(site.url, options);
      if (!live(site)) return false;
      if (retry.up) result = retry;
      else {
        const peer = await confirmFromPeer(site, options);
        if (peer?.up) {
          result = { ...retry, reason: 'REGIONAL_DIFFERENCE', confirmation: 'regional' };
        } else {
          result = { ...retry, confirmation: peer ? 'secondary' : 'primary' };
        }
      }
    }
    if (!live(site)) return false;
    if (scheduled) {
      const period = interval(site);
      const due = site.nextCheck || Math.floor(now / MINUTE) * MINUTE;
      const missed = Math.max(0, Math.floor((now - due) / period));
      if (missed) site.missed = (site.missed || 0) + missed;
      site.nextCheck = due + (missed + 1) * period;
    }
    site.lastCheck = formatDate(now);
    site.lastMs = result.ms;
    site.lastReason = result.reason;
    site.status = inMaintenance(site) ? 'maintenance' : result.confirmation === 'regional' ? 'regional' : result.up ? 'up' : 'down';
    if (!inMaintenance(site)) record(site, result, scheduled);
    if (result.confirmation !== 'regional') applyIncident(site, result, now);
    save();
    return true;
  } finally { checks.delete(site.id); }
}

const LEVELS = [30, 14, 7, 3, 1, 0];
const level = days => LEVELS.filter(value => days <= value).at(-1);
function remind(site, kind, days) {
  if (!Number.isFinite(days)) return;
  const reminders = site.reminders ||= {};
  const threshold = level(days);
  if (threshold === undefined) { delete reminders[kind]; return; }
  if (reminders[kind] !== undefined && reminders[kind] <= threshold) return;
  reminders[kind] = threshold;
  const names = kind === 'ssl' ? ['TLS certificate', 'TLS სერტიფიკატი'] : ['Domain registration', 'დომენის რეგისტრაცია'];
  notifySite(site, kind, message(site, names[0] + ' expiry', names[1] + ' — ვადა', Number(days) + ' d'));
}

function detectChanges(site, snapshot) {
  const previous = site.securitySnapshot || {};
  const changes = [];
  for (const [key, value] of Object.entries(snapshot)) {
    if (value == null) continue;
    if (key in previous && previous[key] !== value) changes.push({ key, before: previous[key], after: value });
    previous[key] = value;
  }
  site.securitySnapshot = previous;
  if (!changes.length) return;
  (site.changes ||= []).push({ at: Date.now(), changes });
  site.changes = site.changes.slice(-100);
  notifySite(site, 'security', message(site, 'Security configuration changed', 'უსაფრთხოების კონფიგურაცია შეიცვალა', changes.map(c => c.key + ': ' + c.before + ' → ' + c.after).join('\n')));
}

async function scanOne(site) {
  if (!live(site) || scans.has(site.id)) return;
  scans.add(site.id);
  try {
    const result = await scan(site.url);
    if (!live(site)) return;
    const now = Date.now();
    site.lastScan = now;
    if (Number.isFinite(result.score)) {
      (site.scores ||= []).push({ t: now, score: result.score, version: result.methodVersion });
      site.scores = site.scores.slice(-120);
    }
    site.ssl = { days: result.ssl.days, ok: result.ssl.ok };
    site.domain = result.details.domain || null;
    const headers = Object.fromEntries(result.headers.map(h => [h.label, h.present]));
    const email = result.details.email;
    detectChanges(site, {
      ...headers, TLS: result.ssl.days == null && !result.up ? null : result.ssl.ok,
      DMARC: email?.applicable ? email.dmarc.policy || 'missing' : null
    });
    remind(site, 'ssl', result.ssl.days);
    remind(site, 'domain', result.details.domain?.days);
    save();
  } finally { scans.delete(site.id); }
}

async function pool(sites, count, task) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(count, sites.length) }, async () => {
    while (index < sites.length) {
      try { await task(sites[index++]); } catch { console.error('Monitor task failed'); }
    }
  }));
}

let sweeping = false;
async function monitorAll() {
  if (sweeping) return;
  sweeping = true;
  try {
    const now = Date.now();
    let state = system();
    if (!state) { state = { id: 'monitor' }; db.system.push(state); }
    state.heartbeat = now;
    save();
    const due = db.sites.filter(site => live(site) && (!site.nextCheck || site.nextCheck <= now));
    await pool(due, 5, site => checkOne(site, { scheduled: true }));
    state.completed = Date.now();
    state.pending = db.sites.filter(site => live(site) && site.nextCheck && site.nextCheck < Date.now() - 2 * MINUTE).length;
    save();
  } finally { sweeping = false; }
}

function backup() {
  const dirs = ['backups', process.env.BACKUP_DIR].filter(Boolean);
  for (const dir of new Set(dirs.map(dir => path.resolve(dir)))) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const filename = 'data-' + formatDate(Date.now()).slice(0, 10) + '.' + backupExt;
    backupTo(path.join(dir, filename));
    fs.readdirSync(dir).filter(file => /^data-\d{4}-\d{2}-\d{2}\.(sqlite|json)$/.test(file)).sort().slice(0, -14)
      .forEach(file => fs.unlinkSync(path.join(dir, file)));
  }
}

async function daily() {
  for (const site of db.sites) pruneHistory(site);
  for (const user of db.users) {
    if (user.dashboardDraft?.expires <= Date.now()) delete user.dashboardDraft;
    if (user.emailAttempt?.expires <= Date.now()) delete user.emailAttempt;
  }
  db.shares = db.shares.filter(share => share.expires > Date.now());
  save();
  try { backup(); } catch { console.error('Backup failed'); }
  await pool(db.sites, 3, scanOne);
}

async function firstRun(site) {
  await checkOne(site, { scheduled: true });
  if (site.verifiedAt) await scanOne(site);
}

function startMonitor() {
  cron.schedule('* * * * *', () => monitorAll().catch(() => console.error('Scheduler sweep failed')), { timezone: 'UTC' });
  cron.schedule('15 4 * * *', () => daily().catch(() => console.error('Daily tasks failed')), { timezone: 'UTC' });
  const queue = setInterval(() => processQueue().catch(() => console.error('Notification queue failed')), 15000);
  queue.unref();
  monitorAll().catch(() => console.error('Initial scheduler sweep failed'));
}
module.exports = { startMonitor, checkOne, firstRun, daily, backup, interval, inMaintenance, system, level };
