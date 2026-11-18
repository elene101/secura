const dns = require('node:dns').promises;
const { UserError } = require('../helpers/errors');
const { readDraft, writeDraft } = require('../helpers/dashboard-draft');
const { computeStats } = require('../services/stats');
const { firstRun, checkOne, interval, inMaintenance } = require('../services/monitor');
const { enqueue, deliveryStatus, wakeQueue, channelsSupported } = require('../services/notify');
const { publicUrl } = require('../services/scan-work');
const { db, save, id } = require('../config/db');
const { activePlan } = require('../config/plans');
const { normalizeUrl, assertPublic } = require('../services/scanner');

const verified = user => {
  if (!user.emailVerified) throw new UserError('Please confirm your email first. Check your inbox for the confirmation link.', 403);
};
const { smsProvider, SMS_ERRORS } = require('../services/sms');
const { siteActive, workspaceActive } = require('../helpers/active-scope');
const { workspaceRole } = require('../helpers/workspace-role');

const workspace = id => db.workspaces.find(item => item.id === id);
function accessible(site, user) {
  return site.userId === user.id || !!workspaceRole(workspace(site.workspaceId), user.id);
}
const canCheck = (site, user) => site.userId === user.id || workspaceRole(workspace(site.workspaceId), user.id) === 'operator';
function get(req, owner = false) {
  const site = db.sites.find(site => site.id === req.params.id && (owner ? site.userId === req.user.id : accessible(site, req.user)));
  if (!site) throw new UserError('Not found', 404);
  return site;
}
function siteView(site, user) {
  const owner = site.userId === user.id;
  const active = siteActive(site);
  const due = active ? site.nextCheck || null : null;
  return {
    id: site.id, label: site.label || '', url: owner ? site.url : publicUrl(site.url), owner, canCheck: active && canCheck(site, user),
    status: !active ? 'inactive' : site.paused ? 'paused' : inMaintenance(site) ? 'maintenance' :
      due && Date.now() > due + 2 * 60000 ? 'stale' : site.status || 'unknown',
    lastCheck: site.lastCheck, nextCheck: site.paused ? null : due, lastReason: site.lastReason,
    interval: interval(site) / 60000, expectedStatus: site.expectedStatus || null,
    expectedText: owner ? site.expectedText || '' : '', verifiedAt: site.verifiedAt || null,
    verification: owner && site.verification ? { name: '_secura-verification.' + new URL(site.url).hostname, value: site.verification } : null,
    maintenanceStart: site.maintenanceStart || null, maintenanceEnd: site.maintenanceEnd || null,
    telegram: owner ? site.telegram || '' : '',
    workspaceId: site.workspaceId || null, alertMembers: owner ? site.alertMembers || [] : [],
    ssl: site.ssl, domain: site.domain,
    activeIncident: site.incidents?.at(-1)?.end ? null : site.incidents?.at(-1) || null
  };
}
function settings(body, site) {
  const changes = {};
  if ('label' in body) changes.label = String(body.label || '').trim().slice(0, 80);
  if ('expectedStatus' in body) {
    const status = body.expectedStatus == null || body.expectedStatus === '' ? null : +body.expectedStatus;
    if (status !== null && (!Number.isInteger(status) || status < 200 || status > 599)) throw new UserError('Choose a valid HTTP status');
    changes.expectedStatus = status;
  }
  if ('expectedText' in body) changes.expectedText = String(body.expectedText || '').slice(0, 200);
  if ('interval' in body) {
    const minutes = +body.interval;
    if (![5, 15, 30].includes(minutes)) throw new UserError('Choose a valid check interval');
    if (minutes < 30 && !site.verifiedAt) throw new UserError('Verify the domain to use a shorter interval');
    if (minutes !== (site.interval || 30)) {
      changes.interval = minutes;
      changes.nextCheck = Date.now() + minutes * 60000;
    }
  }
  if (typeof body.paused === 'boolean' && body.paused !== !!site.paused) {
    changes.paused = body.paused;
    if (!body.paused) changes.nextCheck = Date.now();
  }
  if ('maintenanceStart' in body || 'maintenanceEnd' in body) {
    const start = body.maintenanceStart == null ? null : Number(body.maintenanceStart);
    const end = body.maintenanceEnd == null ? null : Number(body.maintenanceEnd);
    if ((start != null || end != null) && (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 31 * 86400000))
      throw new UserError('Choose a valid maintenance window');
    Object.assign(changes, { maintenanceStart: start, maintenanceEnd: end });
  }
  if ('workspaceId' in body) {
    const team = body.workspaceId && workspace(body.workspaceId);
    if (body.workspaceId && team?.userId !== site.userId) throw new UserError('Workspace not found', 404);
    if (team && team.id !== site.workspaceId && !workspaceActive(team)) throw new UserError('This company workspace is deactivated.', 409);
    changes.workspaceId = team?.id || null;
    if (changes.workspaceId !== site.workspaceId) changes.alertMembers = [];
  }
  if (Array.isArray(body.alertMembers)) {
    const team = workspace('workspaceId' in changes ? changes.workspaceId : site.workspaceId);
    changes.alertMembers = [...new Set(body.alertMembers)].filter(id => team?.members.includes(id));
  }
  if ('telegram' in body) {
    const chat = String(body.telegram || '').trim();
    if (chat && (!site.verifiedAt || !process.env.TELEGRAM_BOT_TOKEN))
      throw new UserError('Verify the domain and configure the Telegram bot first');
    if (chat && !/^-?\d{5,20}$/.test(chat)) throw new UserError('Enter a valid Telegram chat ID');
    changes.telegram = chat || null;
  }
  return changes;
}
exports.list = async (req, res) => {
  const user = req.user;
  res.json(db.sites.filter(site => accessible(site, user)).map(site => siteView(site, user)));
};
exports.add = async (req, res) => {
  verified(req.user);
  const url = normalizeUrl(req.body.url);
  await assertPublic(url.hostname);
  const owned = db.sites.filter(site => site.userId === req.user.id);
  if (owned.some(site => site.url === url.href)) throw new UserError('This URL is already monitored', 409);
  const plan = activePlan(req.user);
  if (owned.length >= plan.sites) throw new UserError('Your plan (' + plan.name + ') allows at most ' + plan.sites + ' site(s). Upgrade your plan.');
  const site = { id: id(), userId: req.user.id, url: url.href, status: 'unknown', nextCheck: Date.now(), verification: 'secura=' + id(24) };
  Object.assign(site, settings(req.body, site));
  db.sites.push(site);
  save();
  res.status(201).json(siteView(site, req.user));
  firstRun(site).catch(() => console.error('Initial check failed'));
};
exports.update = async (req, res) => {
  verified(req.user);
  const site = get(req, true);
  Object.assign(site, settings(req.body, site));
  save();
  res.json(siteView(site, req.user));
};
exports.remove = async (req, res) => {
  const site = get(req, true);
  db.sites = db.sites.filter(item => item !== site);
  db.shares = db.shares.filter(share => share.siteId !== site.id);
  db.notifications = db.notifications.filter(job => job.siteId !== site.id);
  save();
  res.json({ ok: true });
};
exports.check = async (req, res) => {
  const site = get(req);
  if (!canCheck(site, req.user)) throw new UserError('Not found', 404);
  if (site.userId !== req.user.id) verified(req.user);
  if (!siteActive(site)) throw new UserError('This company workspace is deactivated.', 409);
  if (site.paused) throw new UserError('Resume the monitor first', 409);
  if (site.lastManual && Date.now() - site.lastManual < 60000) throw new UserError('Wait a minute before checking again', 429);
  site.lastManual = Date.now();
  save();
  const checked = await checkOne(site);
  res.status(checked ? 200 : 202).json(siteView(site, req.user));
};
exports.stats = async (req, res) => {
  const site = get(req);
  const days = +req.query.days;
  res.json(computeStats(site, [7, 30, 90].includes(days) ? days : 7));
};
exports.verify = async (req, res) => {
  verified(req.user);
  const site = get(req, true);
  const hostname = new URL(site.url).hostname;
  if (site.verifiedAt) return res.json(siteView(site, req.user));
  if (!site.verification) { site.verification = 'secura=' + id(24); save(); }
  const resolver = new dns.Resolver({ timeout: 3500, tries: 1 });
  let records;
  try { records = await resolver.resolveTxt('_secura-verification.' + hostname); }
  catch { records = []; }
  if (!records.some(parts => parts.join('') === site.verification)) throw new UserError('DNS TXT record is not visible yet');
  if (!db.sites.includes(site)) throw new UserError('Not found', 404);
  site.verifiedAt = Date.now();
  save();
  return res.json(siteView(site, req.user));
};
exports.verification = async (req, res) => {
  const site = get(req, true);
  if (!site.verification && !site.verifiedAt) { site.verification = 'secura=' + id(24); save(); }
  res.json(siteView(site, req.user));
};
exports.deliveries = async (req, res) => {
  res.json(db.notifications.filter(job => job.userId === req.user.id && !job.accountMail && channelsSupported.includes(job.channel)).slice(-100).reverse().map(deliveryStatus));
};
exports.testAlert = async (req, res) => {
  verified(req.user);
  const site = req.body.siteId ? get({ ...req, params: { id: req.body.siteId } }, true) : undefined;
  const channel = req.body.channel || 'email';
  if (!channelsSupported.includes(channel)) throw new UserError('Choose a notification channel');
  if (site && !siteActive(site)) throw new UserError('This company workspace is deactivated.', 409);
  if (channel === 'telegram') {
    if (!site) throw new UserError('Choose a monitor to test Telegram.');
    if (!site.telegram || !process.env.TELEGRAM_BOT_TOKEN)
      throw new UserError('Set up the Telegram bot and chat in the monitor settings first.', 503);
  }
  if (channel === 'sms') {
    const { phone, verifiedPhone } = req.user;
    if (!phone || phone !== verifiedPhone) throw new UserError('Save and verify your mobile number in Profile before sending a test SMS.');
    if (!smsProvider(phone)) throw new UserError(SMS_ERRORS.NOT_CONFIGURED, 503);
  }
  const jobs = enqueue(req.user, { site, type: 'test', channels: [channel], message: {
    en: { subject: 'Secura GE test notification', text: 'This is a test of your Secura GE notification channel.' },
    ka: { subject: 'Secura GE · სატესტო შეტყობინება', text: 'ეს არის Secura GE-ის სატესტო შეტყობინება.' }
  } });
  if (!jobs.length) throw new UserError('This channel is not configured');
  save();
  res.status(202).json(jobs.map(deliveryStatus));
  if (channel !== 'email') wakeQueue();
};

exports.draft = async (req, res) => {
  const user = req.user;
  const draft = readDraft(user);
  if ('url' in req.body) {
    if (req.body.url == null) delete draft.url;
    else draft.url = normalizeUrl(req.body.url).href;
  }
  if ('invite' in req.body) {
    if (req.body.invite == null) delete draft.invite;
    else {
      if (typeof req.body.invite !== 'string' || !/^[a-f0-9]{48}$/.test(req.body.invite)) throw new UserError('Invalid invitation link');
      draft.invite = req.body.invite;
    }
  }
  writeDraft(user, draft);
  save();
  res.json({ ok: true });
};
