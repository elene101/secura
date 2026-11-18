import './styles/main.css';
import './styles/app.css';
import './styles/studio.css';
import { mountViews } from './views.js';
import { t, getLang } from './i18n.js';
import { api, esc } from './api/client.js';
import { mountPrefs } from './prefs.js';

const $ = selector => document.querySelector(selector);
const format = time => time ? new Date(time).toLocaleString(getLang() === 'ka' ? 'ka-GE' : 'en-GB') : '—';
const token = new URLSearchParams(location.hash.slice(1)).get('report');
if (token) history.replaceState(null, '', location.pathname);

async function displayStatus() {
  if (!$('#health')) return;
  if (token) {
    $('#health').hidden = true;
    $('#statusTitle').textContent = t('Shareable report');
    const target = $('#sharedReport');
    target.hidden = false;
    try {
      const report = await api('/share', 'POST', { token });
      const metrics = [
        ['Availability in period', report.uptimePeriod == null ? '—' : report.uptimePeriod + '%'],
        ['Completed checks', report.checks + ' / ' + t('{0} days', report.days)],
        ['Last check', format(report.lastCheck)], ['Link expires', format(report.expires)]
      ];
      target.innerHTML = '<h2>' + esc(report.label || report.url) + '</h2>' +
        (report.label ? '<p class="app-caption">' + esc(report.url) + '</p>' : '') +
        '<dl class="report-metrics">' + metrics.map(([key, value]) =>
          '<div><dt>' + esc(t(key)) + '</dt><dd>' + esc(value) + '</dd></div>').join('') + '</dl>';
    } catch (error) { target.textContent = error.message; }
    return;
  }
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const report = await response.json();
    const healthy = report.status === 'operational';
    $('#health').dataset.health = healthy ? 'up' : 'down';
    $('#statusText').dataset.state = healthy ? 'up' : 'down';
    $('#statusText').textContent = t(healthy ? 'Operational' : 'Scheduler degraded');
    $('#lastSweep').textContent = t('Last sweep') + ' · ' + format(report.lastSweep);
  } catch {
    $('#health').dataset.health = 'unknown';
    $('#statusText').dataset.state = 'unknown';
    $('#statusText').textContent = t('Status unavailable');
    $('#lastSweep').textContent = '';
  }
}

async function displaySupport() {
  const target = $('#supportContact');
  if (!target) return;
  try {
    const { email } = await api('/support');
    if (!email) return;
    const link = document.createElement('a');
    link.href = 'mailto:' + email;
    link.textContent = email;
    target.replaceChildren(link);
  } catch {}
}
mountViews($('#main'), { hash: true });
mountPrefs();
displayStatus();
displaySupport();
window.addEventListener('langchange', displayStatus);
if ($('#health') && !token) setInterval(displayStatus, 60000);
