import './styles/main.css';
import './form-validation.js';
import './styles/app.css';
import './styles/studio.css';
import { api, esc } from './api/client.js';
import { getLang, t, applyLang } from './i18n.js';
import { verificationMessage } from './account-mail.js';
import { mountPrefs } from './prefs.js';
import { mountViews } from './views.js';
import { chart } from './chart.js';

const $ = selector => document.querySelector(selector);
const tr = (key, ...values) => esc(t(key, ...values));
const date = value => value ? new Date(value).toLocaleString(getLang() === 'ka' ? 'ka-GE' : 'en-GB') : '—';
const percent = value => value == null ? '—' : value + '%';
const status = {
  up: 'Up', down: 'Down', unknown: 'Pending', stale: 'Check overdue', paused: 'Paused',
  inactive: 'Inactive', maintenance: 'Maintenance', regional: 'Reachability varies by region',
  accepted: 'Accepted by provider', queued: 'Queued', failed: 'Failed', cancelled: 'Cancelled'
};
const eventNames = { down: 'Outage', recovery: 'Recovery', ssl: 'TLS expiry', domain: 'Domain expiry', security: 'Security change', test: 'Test notification' };
const reasons = {
  CONTENT_MISMATCH: 'Expected text missing', REGIONAL_DIFFERENCE: 'Reachability varies by region',
  ETIMEDOUT: 'Timeout', ABORT_ERR: 'Timeout', ENOTFOUND: 'DNS lookup failed',
  EAI_AGAIN: 'DNS lookup failed', ECONNREFUSED: 'Connection refused', TLS: 'TLS validation failed',
  UNREACHABLE: 'Could not connect', TARGET_BLOCKED: 'Target blocked'
};
const pill = key => `<span class="app-pill" data-state="${esc(key)}">${tr(status[key] || key)}</span>`;
const reason = key => key ? tr(reasons[key] || key) : '—';
const inputDate = time => time ? new Date(time - new Date(time).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const formatDays = value => Number.isFinite(value) ? tr('{0} days left', value) : '—';

let sites = [], workspaces = [], selected = null, profile, days = 7, sequence = 0;
let detailView = 'overview', settingView = 'check-settings', monitorPage = 0;
const MONITORS_PER_PAGE = 5;
const root = $('#main');
const dashboardViews = mountViews(root);
function captureInvitation() {
  const token = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (!token) return false;
  sessionStorage.setItem('secura_invite', token);
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}
captureInvitation();

let inviteFlight, inviteOutcome;
const invitationMessages = {
  accepted: 'Workspace invitation accepted.',
  declined: 'Workspace invitation declined.',
  pending: 'You have been invited to join {0}.',
  waiting: 'Waiting for the invited member to respond.',
  verification: 'Confirm your email to respond to this invitation.',
  wrongAccount: 'Sign in with the email address that was invited.',
  expired: 'This invitation has expired. Ask the workspace owner for a new link.',
  invalid: 'This invitation link is invalid.',
  inactive: 'This company workspace is deactivated.'
};
const invitationError = error => ({ 403: 'wrongAccount', 404: 'invalid', 410: 'expired', 409: 'inactive' })[error.status];

function paintInvitation() {
  const { state, workspace, error } = inviteOutcome || {};
  $('#inviteNotice').hidden = !state;
  $('#inviteNotice').dataset.state = error ? 'error' : state || '';
  $('#inviteMessage').textContent = error || (state ? t(invitationMessages[state], workspace) : '');
  $('#inviteSwitch').hidden = state !== 'wrongAccount';
  $('#inviteAccept').hidden = $('#inviteDecline').hidden = state !== 'pending';
}

async function forgetInvite(token, { preserveInTab = false } = {}) {
  if (!token) return;
  if (!preserveInTab && sessionStorage.getItem('secura_invite') === token) sessionStorage.removeItem('secura_invite');
  if (profile.pending?.invite === token) {
    await api('/dashboard/draft', 'PUT', { invite: null });
    delete profile.pending.invite;
  }
}

function showInviteOutcome(details, result) {
  const states = { verification_required: 'verification', pending: result.sender ? 'waiting' : 'pending' };
  const state = states[result.status] || result.status;
  const previous = inviteOutcome?.state;
  inviteOutcome = { details, state, workspace: result.workspace };
  paintInvitation();
  if (state === 'pending' && previous !== 'pending') dashboardViews.show('workspaces');
  if (state === 'accepted' || state === 'declined') {
    if (sessionStorage.getItem('secura_invite') === details.token) sessionStorage.removeItem('secura_invite');
    if (details.token && profile.pending?.invite === details.token) delete profile.pending.invite;
  }
}

async function previewInvitation(token) {
  if (!token || inviteFlight) return;
  const details = { token };
  inviteFlight = (async () => {
    try {
      const result = await api('/workspaces/invitations/preview', 'POST', details);
      if (result.status === 'verification_required') profile.pending = { ...profile.pending, invite: token };
      showInviteOutcome(details, result);
    } catch (error) {
      const state = invitationError(error);
      if (!state) throw error;
      inviteOutcome = { details, state };
      paintInvitation();
      if (state === 'expired' || state === 'invalid') await forgetInvite(token);
    }
  })().finally(() => { inviteFlight = null; });
  return inviteFlight;
}

async function respondToInvite(details, decision) {
  if (inviteFlight) return;
  inviteFlight = (async () => {
    try {
      const result = await api('/workspaces/accept', 'POST', { ...details, decision });
      showInviteOutcome(details, result);
    } catch (error) {
      const state = error.status === 403 && !profile.emailVerified ? 'verification' : invitationError(error);
      inviteOutcome = state ? { details, state } : { details, state: 'pending', error: error.message };
      paintInvitation();
      if (state !== 'expired' && state !== 'invalid') return;
      await forgetInvite(details.token);
    }
    dashboardViews.show('workspaces');
    await Promise.all([loadTeams(), loadSites(true)]);
  })().finally(() => { inviteFlight = null; });
  return inviteFlight;
}

$('#inviteAccept').onclick = action(() => respondToInvite(inviteOutcome.details, 'accept'));
$('#inviteDecline').onclick = action(() => respondToInvite(inviteOutcome.details, 'decline'));
$('#inviteSwitch').onclick = action(async () => {
  const token = inviteOutcome?.details.token;
  if (!token) return;
  sessionStorage.setItem('secura_invite', token);
  await forgetInvite(token, { preserveInTab: true });
  await api('/logout', 'POST');
  location.replace('/auth.html');
});

$('#inviteDismiss').onclick = action(async () => {
  if (inviteFlight) return;
  await forgetInvite(inviteOutcome?.details.token);
  inviteOutcome = null;
  paintInvitation();
});

function feedback(message, error = false) {
  $('#feedback').textContent = message;
  $('#feedback').dataset.error = error;
}
function action(handler) {
  return async event => {
    event.preventDefault();
    const source = event.submitter || event.currentTarget;
    if (source.disabled) return;
    source.disabled = true;
    try { await handler(event); }
    catch (error) { feedback(error.message, true); }
    finally { source.disabled = false; }
  };
}

function renderSummary() {
  const numbers = [
    ['Monitors', sites.length], ['Active incidents', sites.filter(s => s.activeIncident).length],
    ['Checks overdue', sites.filter(s => s.status === 'stale').length],
    ['Expiring within 30 days', sites.filter(s => [s.ssl?.days, s.domain?.days].some(d => Number.isFinite(d) && d <= 30)).length]
  ];
  $('#summary').innerHTML = numbers.map(([label, count]) => `<div><strong>${count}</strong><span>${tr(label)}</span></div>`).join('');
  paintMonitorList();
  const options = $('#testSites');
  const chosen = options.value;
  options.innerHTML = `<option value="">${tr('Account')}</option>` + sites.filter(site => site.owner)
    .map(site => `<option value="${esc(site.id)}">${esc(site.label || site.url)}</option>`).join('');
  options.value = Array.from(options.options).some(option => option.value === chosen) ? chosen : '';
}

function paintMonitorList() {
  const pages = Math.max(1, Math.ceil(sites.length / MONITORS_PER_PAGE));
  monitorPage = Math.min(monitorPage, pages - 1);
  const visible = sites.slice(monitorPage * MONITORS_PER_PAGE, (monitorPage + 1) * MONITORS_PER_PAGE);
  $('#monitorList').innerHTML = visible.length ? visible.map(site => `
    <button type="button" class="app-monitor" data-site="${esc(site.id)}" aria-current="${site.id === selected}">
      <span class="monitor-glyph" aria-hidden="true"><span class="corner-arrow"></span></span>
      <span class="monitor-name"><strong>${esc(site.label || site.url)}</strong>${site.label ? `<code>${esc(site.url)}</code>` : ''}</span>
      ${pill(site.status)}
    </button>`).join('') : `<p class="studio-empty">${tr('You have not added any sites yet.')}</p>`;
  $('#monitorPages').innerHTML = pages > 1 ? `<button type="button" class="ghost" data-step="-1" ${monitorPage === 0 ? 'disabled' : ''}>${tr('Previous')}</button>
    <span>${monitorPage + 1} / ${pages}</span><button type="button" class="ghost" data-step="1" ${monitorPage === pages - 1 ? 'disabled' : ''}>${tr('Next')}</button>` : '';
}

$('#monitorPages').onclick = event => {
  const control = event.target.closest('[data-step]');
  if (control) { monitorPage += +control.dataset.step; paintMonitorList(); }
};

function teamMembers(site, teamId) {
  const team = workspaces.find(item => item.id === teamId && item.owner);
  return team?.members.map(member => `<label class="member-check"><input type="checkbox" name="member" value="${esc(member.id)}" ${site.alertMembers.includes(member.id) ? 'checked' : ''}> ${esc(member.email)}</label>`).join('')
    || `<p class="app-caption">${tr('No workspace members available.')}</p>`;
}
function monitorSettings(site) {
  const options = [30, 15, 5].map(minutes => `<option value="${minutes}" ${minutes === site.interval ? 'selected' : ''}
    ${minutes < 30 && !site.verifiedAt ? 'disabled' : ''}>${tr('{0} minutes', minutes)}</option>`).join('');
  const workspaceOptions = workspaces.filter(item => item.owner).map(item => `<option value="${esc(item.id)}" ${site.workspaceId === item.id ? 'selected' : item.deactivated ? 'disabled' : ''}>${esc(item.name)}</option>`).join('');
  const verification = site.verifiedAt ? `<p>${tr('Domain verified')}</p>` : site.verification ?
    `<p>${tr('Add a DNS TXT record with this name and value.')}</p>
      <p><code>${esc(site.verification.name)}</code><br><code>${esc(site.verification.value)}</code></p>
      <button class="ghost" type="button" data-command="verify">${tr('Verify domain')}</button>` :
    `<button class="ghost" type="button" data-command="verification">${tr('Get verification record')}</button>`;
  return `<div class="app-settings" data-views>
    <div class="view-tabs" role="tablist" aria-label="${tr('Monitor settings')}">
      <button type="button" data-tab="check-settings">${tr('Checks')}</button>
      <button type="button" data-tab="routing">${tr('Alert routing')}</button>
      <button type="button" data-tab="verification">${tr('Domain verification')}</button>
      <button type="button" data-tab="sharing">${tr('Shareable report')}</button>
    </div>
    <form id="monitorSettings">
      <section id="settings-checks" data-view="check-settings" class="settings-content">
        <div class="row">
          <label>${tr('Display name')}<input name="label" value="${esc(site.label)}" maxlength="80"></label>
          <label>${tr('Check interval')}<select name="interval">${options}</select></label>
          <label>${tr('Expected HTTP status')}<input name="expectedStatus" type="number" min="200" max="599" value="${esc(site.expectedStatus ?? '')}" placeholder="2xx"></label>
          <label>${tr('Expected response text')}<input name="expectedText" value="${esc(site.expectedText)}" maxlength="200"></label>
          <label>${tr('Maintenance starts')}<input name="maintenanceStart" type="datetime-local" value="${inputDate(site.maintenanceStart)}"></label>
          <label>${tr('Maintenance ends')}<input name="maintenanceEnd" type="datetime-local" value="${inputDate(site.maintenanceEnd)}"></label>
        </div>
      </section>
      <section id="settings-routing" data-view="routing" class="settings-content" hidden>
        <div class="row">
          <label>${tr('Workspace')}<select name="workspaceId"><option value="">${tr('Personal')}</option>${workspaceOptions}</select></label>
          <label>${tr('Telegram chat ID')}<input name="telegram" value="${esc(site.telegram)}" maxlength="21" ${!site.verifiedAt ? 'disabled' : ''}></label>
        </div>
        <fieldset><legend>${tr('Additional alert recipients')}</legend><div id="alertMembers" class="fold-region">${teamMembers(site, site.workspaceId)}</div></fieldset>
      </section>
      <div class="app-actions settings-save"><button>${tr('Save changes')}</button></div>
    </form>
    <section id="settings-verification" data-view="verification" class="settings-content" hidden>${verification}</section>
    <section id="settings-sharing" data-view="sharing" class="settings-content" hidden>
      <p class="app-caption">${tr('The link shows 30 days of availability and expires in 7 days.')}</p>
      <div class="app-actions"><button type="button" data-command="share">${tr('Create report link')}</button>
        <button type="button" class="ghost" data-command="revoke">${tr('Revoke link')}</button></div>
      <input class="app-share-link" id="reportLink" aria-label="${tr('Shareable report')}" readonly hidden>
    </section>
  </div>`;
}

function renderDetail(site) {
  $('#monitorDetail').innerHTML = `<div class="monitor-detail-layout" data-views>
    <div class="monitor-title">
      <button type="button" class="ghost return-monitors" data-list>${tr('Monitors')}</button>
      <div><h2>${esc(site.label || site.url)}</h2>${site.label ? `<p class="app-caption">${esc(site.url)}</p>` : ''}</div>
      ${pill(site.status)}
    </div>
    <div class="view-tabs detail-tabs" role="tablist" aria-label="${tr('Monitor details')}">
      <button type="button" data-tab="overview">${tr('Overview')}</button>
      <button type="button" data-tab="history">${tr('History')}</button>
      <button type="button" data-tab="activity">${tr('Activity')}</button>
      ${site.owner ? `<button type="button" data-tab="settings">${tr('Settings')}</button>` : ''}
    </div>
    <section id="detail-overview" data-view="overview">
      <div class="monitor-timing">
        <div><small>${tr('Last check')}</small><strong>${esc(date(site.lastCheck))}</strong></div>
        <div><small>${tr('Next check')}</small><strong>${esc(date(site.nextCheck))}</strong></div>
        ${site.lastReason ? `<div><small>${tr('Last result')}</small><strong>${reason(site.lastReason)}</strong></div>` : ''}
      </div>
      <div id="monitorStats" aria-live="polite"><p class="muted">${tr('Loading…')}</p></div>
      ${site.canCheck ? `<div class="app-actions monitor-actions">
        <button type="button" data-command="check" ${site.status === 'paused' ? 'disabled' : ''}>${tr('Check now')}</button>
        ${site.owner ? `<button type="button" class="ghost" data-command="pause">${tr(site.status === 'paused' ? 'Resume' : 'Pause')}</button>
        <button type="button" class="ghost danger-action" data-command="remove">${tr('Delete')}</button>` : ''}
      </div>` : ''}
    </section>
    <section id="detail-history" data-view="history" hidden>
      <form id="period" class="app-form"><label>${tr('Period')}<select name="days">${[7, 30, 90].map(d => `<option value="${d}" ${d === days ? 'selected' : ''}>${tr('{0} days', d)}</option>`).join('')}</select></label></form>
      <div id="monitorCharts"><p class="muted">${tr('Loading…')}</p></div>
    </section>
    <section id="detail-activity" data-view="activity" hidden><div id="monitorActivity" class="activity-grid"><p class="muted">${tr('Loading…')}</p></div></section>
    ${site.owner ? `<section id="detail-settings" data-view="settings" hidden>${monitorSettings(site)}</section>` : ''}
  </div>`;
  const detail = $('#monitorDetail [data-views]');
  mountViews(detail, { initial: detailView });
  detail.addEventListener('click', () => { detailView = detail.dataset.activeView; });
  detail.addEventListener('keydown', () => { detailView = detail.dataset.activeView; });
  const settings = $('.app-settings');
  if (settings) {
    mountViews(settings, { initial: settingView });
    settings.addEventListener('click', () => { settingView = settings.dataset.activeView; });
    settings.addEventListener('keydown', () => { settingView = settings.dataset.activeView; });
  }
  const form = $('#monitorSettings');
  if (form) {
    form.elements.workspaceId.onchange = () => { $('#alertMembers').innerHTML = teamMembers(site, form.elements.workspaceId.value); };
    form.onsubmit = action(async () => {
      const fields = new FormData(form);
      const body = Object.fromEntries(fields);
      body.alertMembers = fields.getAll('member');
      delete body.member;
      for (const key of ['maintenanceStart', 'maintenanceEnd']) body[key] = body[key] ? new Date(body[key]).getTime() : null;
      await api('/sites/' + site.id, 'PUT', body);
      feedback(t('Saved'));
      await loadSites(true);
    });
  }
  $('#period').onchange = () => { days = +$('#period').elements.days.value; loadStats(site.id); };
  loadStats(site.id);
}

async function loadStats(id) {
  const request = ++sequence;
  try {
    const stats = await api('/sites/' + id + '/stats?days=' + days);
    if (request !== sequence || selected !== id) return;
    const incidentRows = stats.incidents.map(item => `<li><strong>${reason(item.reason)}</strong>
      <div class="app-caption">${esc(date(item.start))} → ${item.end ? esc(date(item.end)) : tr('Ongoing')}
      ${item.end ? ' · ' + tr('{0} min elapsed', Math.max(1, Math.round((item.end - item.start) / 60000))) : ''}
      ${item.confirmation === 'secondary' ? ' · ' + tr('Confirmed from second region') : ''}</div></li>`).join('');
    const changeRows = stats.changes.map(item => `<li><div class="app-caption">${esc(date(item.at))}</div>
      ${item.changes.map(c => `<div>${esc(c.key)} · ${esc(c.before)} → ${esc(c.after)}</div>`).join('')}</li>`).join('');
    $('#monitorStats').innerHTML = `<div class="app-summary detail-metrics">
      ${[['Uptime (24 h)', percent(stats.uptime24h)], ['Completed checks', stats.checks], ['Missed scheduled checks', stats.missed]].map(([key, value]) => `<div><strong>${value}</strong><span>${tr(key)}</span></div>`).join('')}
      </div><p class="app-caption">${tr('Availability is calculated from completed scheduled checks.')}</p>
      <div class="expiry-row"><span>SSL <b>${formatDays(stats.ssl?.days)}</b></span><span>${tr('Domain')} <b>${formatDays(stats.domain?.days)}</b></span></div>`;
    $('#monitorCharts').innerHTML = `<p class="app-caption">${tr('Availability in period')} <strong>${percent(stats.uptimePeriod)}</strong></p>
      <div class="chart-grid"><div><h3>${tr('Response time')}</h3>${chart(stats.history, { unit: ' ms', label: t('Response time') })}</div>
      <div><h3>${tr('Score history')}</h3>${chart(stats.scores, { min: 0, max: 100, label: t('Score history') })}</div></div>`;
    $('#monitorActivity').innerHTML = `<section><h3>${tr('Incidents')}</h3><ul class="app-list fold-region">${incidentRows || `<li class="muted">${tr('No incidents recorded.')}</li>`}</ul></section>
      <section><h3>${tr('Security changes')}</h3><ul class="app-list fold-region">${changeRows || `<li class="muted">${tr('No security changes recorded.')}</li>`}</ul></section>`;
  } catch (error) {
    if (request === sequence && selected === id) {
      for (const id of ['monitorStats', 'monitorCharts', 'monitorActivity']) $('#' + id).textContent = error.message;
    }
  }
}

async function loadSites(refreshDetails = false) {
  const previouslySelected = selected;
  const previouslyAllowed = sites.find(item => item.id === selected)?.canCheck;
  sites = await api('/sites');
  selected = sites.some(site => site.id === selected) ? selected : sites[0]?.id || null;
  renderSummary();
  const site = sites.find(item => item.id === selected);
  if (site && (refreshDetails || selected !== previouslySelected || site.canCheck !== previouslyAllowed)) renderDetail(site);
  if (!site) {
    root.classList.remove('show-monitor-detail');
    $('#monitorDetail').innerHTML = '<p class="studio-empty">' + tr('Select a monitor to see history and settings.') + '</p>';
  }
}
async function loadDeliveries() {
  const jobs = await api('/notifications');
  $('#deliveries').innerHTML = jobs.length ? `<ul class="app-list">
    ${jobs.slice(0, 12).map(job => `<li>${tr(eventNames[job.type] || job.type)} · ${esc(job.channel)} ${pill(job.state)}
      <div class="app-caption">${esc(date(job.finished || job.created))} · ${tr('{0} attempts', job.attempts)}</div>
      ${job.lastError ? `<div class="app-caption">${tr(deliveryErrors[job.lastError] || 'Provider request failed')}
        ${job.state === 'queued' ? ' · ' + tr('Next attempt') + ' ' + esc(date(job.due)) : ''}</div>` : ''}</li>`).join('')}
    </ul>` : `<p class="muted">${tr('No notifications yet.')}</p>`;
}
const roleNames = { owner: 'Owner', viewer: 'Viewer', operator: 'Operator' };
const responseNames = { accepted: 'Accepted', declined: 'Declined', pending: 'Awaiting response' };
const deliveryErrors = {
  NOT_CONFIGURED: 'Provider is not configured',
  SMS_CREDENTIALS: 'The SMS provider rejected the server credentials.',
  SMS_REJECTED: 'The SMS provider rejected the message. Check the sender and provider account.',
  SMS_UNAVAILABLE: 'The SMS provider did not respond. Try again later.'
};
const inviteLinks = new Map();
let teamsSnapshot, teamRead = 0;
async function loadTeams(force = false) {
  const request = ++teamRead;
  const [teams, incoming] = await Promise.all([api('/workspaces'), api('/workspaces/invitations')]);
  if (request !== teamRead) return;
  const snapshot = JSON.stringify([teams, incoming, getLang(), profile.emailVerified]);
  if (!force && teamsSnapshot === snapshot) return;
  const open = new Set([...$('#workspaces').querySelectorAll('details[open]')].map(item => item.dataset.workspace));
  const emailDrafts = new Map([...$('#workspaces').querySelectorAll('[data-invite]')].map(form => [form.dataset.invite, form.elements.email.value]));
  teamsSnapshot = snapshot;
  workspaces = teams;
  $('#incomingInvites').innerHTML = incoming.length ? `<h3>${tr('Incoming invitations')}</h3><ul class="app-list">
    ${incoming.map(invite => `<li class="workspace-entry"><strong>${esc(invite.workspace)}</strong>
      ${profile.emailVerified ? `<div class="app-actions"><button type="button" data-response="accept" data-reference="${esc(invite.reference)}">${tr('Accept invitation')}</button>
      <button type="button" class="ghost" data-response="decline" data-reference="${esc(invite.reference)}">${tr('Decline invitation')}</button></div>`
      : `<p class="muted">${tr('Confirm your email to respond to this invitation.')}</p>`}</li>`).join('')}</ul>` : '';
  $('#workspaces').innerHTML = workspaces.length ? workspaces.map(team => `<details data-workspace="${esc(team.id)}" ${open.has(team.id) ? 'open' : ''}>
    <summary>${esc(team.name)} · ${tr(roleNames[team.role])}${team.deactivated ? ' · ' + tr('Inactive') : team.owner && team.invitations.some(invite => invite.status === 'pending') ? ' · ' + tr('Awaiting response') : ''}</summary>
    ${team.owner ? `<div class="app-actions"><button type="button" class="ghost" data-team-state="${esc(team.id)}" data-active="${String(team.deactivated)}">${tr(team.deactivated ? 'Reactivate company workspace' : 'Deactivate company workspace')}</button></div>` : ''}
    ${team.deactivated ? `<p class="muted">${tr('Monitoring and member access are paused for this company workspace.')}</p>` : ''}
    ${team.owner && !team.deactivated ? `<form class="app-form" data-invite="${esc(team.id)}">
      <label>${tr('Member email')}<input name="email" type="email" value="${esc(emailDrafts.get(team.id) || '')}" required></label><button class="ghost">${tr('Create invite')}</button>
      </form><div class="invite-link" data-invite-result="${esc(team.id)}" ${inviteLinks.has(team.id) ? '' : 'hidden'}>
        <label>${tr('Invite link')}<input class="app-share-link" value="${esc(inviteLinks.get(team.id) || '')}" readonly></label>
        <button class="ghost" type="button" data-copy-invite>${tr('Copy link')}</button>
        <p class="muted">${tr('Send this link to the invited member. Only the invited account can join.')}</p>
      </div>
      ${team.invitations.length ? `<h3>${tr('Invitation responses')}</h3><ul class="app-list workspace-invites">${team.invitations.map(invite => `<li class="workspace-entry"><span>${esc(invite.email)}</span><span class="app-pill" data-state="${esc(invite.status)}">${tr(responseNames[invite.status])}</span></li>`).join('')}</ul>` : ''}
      ${team.members.length ? `<h3>${tr('Members')}</h3><ul class="app-list">${team.members.map(member => `<li>
        <form class="workspace-entry" data-role="${esc(member.id)}" data-team="${esc(team.id)}">
          <span>${esc(member.email)}</span>
          <label>${tr('Role')}<select name="role">${['viewer', 'operator'].map(role => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${tr(roleNames[role])}</option>`).join('')}</select></label>
          <div class="app-actions"><button type="submit" class="ghost">${tr('Save role')}</button>
          <button type="button" class="ghost" data-member="${esc(member.id)}" data-team="${esc(team.id)}">${tr('Remove')}</button></div>
        </form></li>`).join('')}</ul>
        <p class="app-caption">${tr('Viewers can read monitor results. Operators can also run checks.')}</p>` : ''}` : ''}
    </details>`).join('') : `<p class="muted">${tr('No workspaces yet.')}</p>`;
}


$('#monitorList').onclick = event => {
  const control = event.target.closest('button[data-site]');
  if (!control) return;
  selected = control.dataset.site;
  detailView = 'overview';
  settingView = 'check-settings';
  root.classList.add('show-monitor-detail');
  for (const button of $('#monitorList').querySelectorAll('button')) button.setAttribute('aria-current', button === control);
  renderDetail(sites.find(site => site.id === selected));
};
$('#monitorDetail').onclick = async event => {
  if (event.target.closest('[data-list]')) {
    root.classList.remove('show-monitor-detail');
    $('#monitorList [aria-current="true"]')?.focus();
    return;
  }
  const button = event.target.closest('[data-command]');
  if (!button) return;
  const site = sites.find(item => item.id === selected);
  if (!site || (button.dataset.command === 'check' ? !site.canCheck : !site.owner)) return;
  const root = '/sites/' + site.id;
  const command = button.dataset.command;
  const guarded = action(async () => {
    if (command === 'check') await api(root + '/check', 'POST');
    if (command === 'pause') await api(root, 'PUT', { paused: site.status !== 'paused' });
    if (command === 'remove') {
      if (!confirm(t('Delete this monitor and its history?'))) return;
      await api(root, 'DELETE');
      $('#main').classList.remove('show-monitor-detail');
    }
    if (command === 'verification') await api(root + '/verification');
    if (command === 'verify') await api(root + '/verification', 'POST');
    if (command === 'share' || command === 'revoke') {
      const result = await api(root + '/share', 'POST', { revoke: command === 'revoke' });
      const field = $('#reportLink');
      if (field && selected === site.id) {
        field.hidden = !result.path;
        field.value = result.path ? new URL(result.path, location.origin).href : '';
        if (!field.hidden) { field.focus(); field.select(); }
      }
      return;
    }
    await loadSites(true);

  });
  await guarded({ preventDefault: () => {}, currentTarget: button });
};
$('#monitorAdd').onsubmit = action(async () => {
  const result = await api('/sites', 'POST', { url: $('#monitorUrl').value });
  sessionStorage.removeItem('secura_pending_url');
  profile.pending = null;
  api('/dashboard/draft', 'PUT', { url: null }).catch(() => {});
  $('#monitorUrl').value = '';
  selected = result.id;
  detailView = 'overview';
  settingView = 'check-settings';
  monitorPage = Math.floor(sites.length / MONITORS_PER_PAGE);
  root.classList.add('show-monitor-detail');
  feedback(t('Site added to monitoring'));
  await loadSites(true);
});
$('#testAlert').onsubmit = action(async () => {
  const fields = new FormData($('#testAlert'));
  const state = $('#testFeedback');
  state.textContent = '';
  state.dataset.error = 'false';
  try {
    await api('/notifications/test', 'POST', { channel: fields.get('channel'), siteId: fields.get('site') || null });
    state.textContent = t('Test notification queued.');
  } catch (error) {
    state.dataset.error = 'true';
    state.textContent = error.message;
    return;
  }
  await loadDeliveries();
});
$('#teamAdd').onsubmit = action(async () => {
  const form = $('#teamAdd');
  await api('/workspaces', 'POST', { name: form.elements.name.value });
  form.reset();
  await loadTeams();
  await loadSites(true);
});
$('#incomingInvites').onclick = async event => {
  const button = event.target.closest('[data-response]');
  if (!button) return;
  await respondToInvite({ reference: button.dataset.reference }, button.dataset.response).catch(reportError);
};
$('#workspaces').onsubmit = action(async event => {
  const form = event.target;
  const { invite: team, role: member } = form.dataset;
  if (member) {
    await api('/workspaces/' + form.dataset.team + '/members/' + member, 'PATCH', { role: form.elements.role.value });
    feedback(t('Workspace role updated.'));
    await loadTeams();
    return;
  }
  if (!team) return;
  const result = await api('/workspaces/' + team + '/invite', 'POST', { email: form.elements.email.value });
  inviteLinks.set(team, new URL(result.path, location.origin).href);
  form.reset();
  await loadTeams(true);
  const field = [...$('#workspaces').querySelectorAll('[data-invite-result]')].find(item => item.dataset.inviteResult === team).querySelector('input');
  field.focus(); field.select();
});
$('#workspaces').onclick = async event => {
  const state = event.target.closest('[data-team-state]');
  if (state) {
    const active = state.dataset.active === 'true';
    if (!active && !confirm(t('Deactivate this company workspace and pause its monitoring?'))) return;
    const apply = action(async () => {
      await api('/workspaces/' + state.dataset.teamState + '/state', 'PATCH', { active });
      feedback(t(active ? 'Company workspace reactivated.' : 'Company workspace deactivated.'));
      await loadTeams();
      await loadSites(true);
    });
    await apply({ preventDefault: () => {}, currentTarget: state });
    return;
  }
  const copy = event.target.closest('[data-copy-invite]');
  if (copy) {
    const field = copy.parentElement.querySelector('input');
    try {
      await navigator.clipboard.writeText(field.value);
      feedback(t('Invitation link copied.'));
    } catch {
      field.focus();
      field.select();
    }
    return;
  }
  const button = event.target.closest('[data-member]');
  if (!button || !confirm(t('Remove this workspace member?'))) return;
  const guarded = action(async () => {
    await api('/workspaces/' + button.dataset.team + '/members/' + button.dataset.member, 'DELETE');
    await loadTeams();
    await loadSites(true);
  });
  await guarded({ preventDefault: () => {}, currentTarget: button });
};
$('#resend').onclick = action(async () => {
  const result = await api('/verify-email/resend', 'POST');
  if (result.queued) profile.verificationDelivery = 'queued';
  else profile = await api('/me');
  updateVerificationNotice();
});

function updateVerificationNotice() {
  $('#verifyGate').hidden = profile.emailVerified;
  $('#verifyMessage').textContent = verificationMessage(profile);
}

mountPrefs();
async function init() {
  if (!profile) {
    try { profile = await api('/me'); }
    catch (error) {
      if (error.status === 401) { location.replace('/auth.html'); return; }
      throw error;
    }
  }
  if (profile.onboardingPending) { location.replace('/auth.html?setup'); return; }
  updateVerificationNotice();
  $('#adminLink').hidden = !profile.isAdmin;
  const draft = {};
  const pending = sessionStorage.getItem('secura_pending_url') || profile.pending?.url;
  if (pending && !$('#monitorUrl').value) { $('#monitorUrl').value = pending; $('#monitorUrl').focus(); }
  const token = sessionStorage.getItem('secura_invite') || profile.pending?.invite;
  if (pending && pending !== profile.pending?.url) draft.url = pending;
  if (Object.keys(draft).length && !profile.emailVerified) {
    await api('/dashboard/draft', 'PUT', draft);
    profile.pending = { ...profile.pending, ...draft };
  }
  if (token && (!inviteOutcome || (inviteOutcome.state === 'verification' && profile.emailVerified))) await previewInvitation(token);
  paintInvitation();
  await Promise.all([loadTeams(), loadDeliveries()]);
  await loadSites(true);
  applyLang();
}
const reportError = error => {
  if (error.status === 401) location.replace('/auth.html');
  else feedback(error.message, true);
};
init().catch(reportError);
window.addEventListener('langchange', () => init().catch(reportError));
window.addEventListener('hashchange', async () => {
  if (!captureInvitation()) return;
  await inviteFlight?.catch(() => {});
  inviteOutcome = null;
  init().catch(reportError);
});
function refreshInvitations() {
  if (document.hidden || !profile) return;
  const current = inviteOutcome;
  if (current && ['waiting', 'pending'].includes(current.state) && !current.error)
    previewInvitation(current.details.token).catch(reportError);
  if (current?.state === 'wrongAccount') {
    api('/me').then(updated => {
      if (updated.email !== profile.email) location.reload();
    }).catch(error => { if (error.status === 401) location.replace('/auth.html'); });
  }
  if (root.dataset.activeView === 'workspaces') loadTeams().catch(reportError);
}
window.addEventListener('focus', refreshInvitations);
setInterval(refreshInvitations, 12000);
setInterval(() => {
  if (document.hidden || !profile) return;
  if (!profile.emailVerified) {
    api('/me').then(updated => {
      profile = updated;
      if (updated.emailVerified) return init();
      updateVerificationNotice();
    }).catch(reportError);
  }
  Promise.all([loadSites(), loadDeliveries()]).catch(reportError);
}, 30000);
