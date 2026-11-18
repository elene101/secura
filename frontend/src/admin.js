import './styles/main.css';
import './form-validation.js';
import './styles/app.css';
import './styles/studio.css';
import { mountViews } from './views.js';
import { paginate } from './pager.js';
import { api, esc, hasSession, dropSession } from './api/client.js';
import { t, getLang } from './i18n.js';
import { mountPrefs } from './prefs.js';
const $ = s => document.querySelector(s);
mountViews($('#app'));
const fmt = d => d ? new Date(d).toLocaleString(getLang() === 'ka' ? 'ka-GE' : 'en-GB') : '—';
const table = (head, rows) => `<tr>${head.map(h => `<th scope="col">${esc(t(h))}</th>`).join('')}</tr>` + (rows.join('') || `<tr><td colspan="${head.length}" >${esc(t('Empty'))}</td></tr>`);

async function load() {
  let d;
  try { d = await api('/admin/overview'); }
  catch (e) {
    $('#login').hidden = false; $('#app').hidden = true; $('#logout').hidden = true;
    $('#lMsg').textContent = hasSession() ? e.message : '';
    $('#adminAccess').hidden = false;
    return;
  }
  $('#adminAccess').hidden = true;
  $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false;
  const s = d.stats;
  $('#stats').innerHTML = [
    ['Users', s.users], ['On a paid plan', s.activePaid], ['Sites', s.sites],
    ['Up / Down', `${s.up} / ${s.down}`], ['Paid orders', s.paidOrders], ['Revenue', s.revenue + ' ₾']
  ].map(([k, v]) => `<div class="stat"><small>${esc(t(k))}</small><b>${v}</b></div>`).join('');
  const opt = p => ['free', 'start', 'business'].map(x => `<option value="${x}" ${x === p ? 'selected' : ''}>${x}</option>`).join('');
  $('#users').innerHTML = table(['Email', 'Verified', 'Company', 'Phone', 'Plan', 'Expires', 'Sites', ''], d.users.map(u => `
    <tr data-id="${u.id}"><td>${esc(u.email)}</td><td>${u.verified ? '✓' : '✗'}</td><td>${esc(u.company || '—')}</td><td>${u.phone ? '+' + esc(u.phone) : '—'}</td>
    <td><select>${opt(u.plan)}</select></td><td>${u.plan === 'free' ? '—' : fmt(u.planUntil)}</td><td>${u.sites}</td>
    <td><button data-act="grant">Grant for 30 days</button> <button class="ghost" data-act="del">Delete</button></td></tr>`));
  $('#sites').innerHTML = table(['Site', 'Owner', 'Status', 'Last check', ''], d.sites.map(x => `
    <tr data-id="${x.id}"><td>${esc(x.url)}</td><td>${esc(x.owner)}</td><td><i class="dot ${x.status}"></i>${esc(x.status)}</td><td>${fmt(x.lastCheck)}</td>
    <td><button class="ghost" data-act="delsite">Delete</button></td></tr>`));
  $('#reviews').innerHTML = table(['Time', 'User', 'Rating', 'Comment', ''], d.reviews.map(r => `
    <tr data-id="${r.id}"><td>${fmt(r.createdAt)}</td><td>${esc(r.who)} (${esc(r.email)})</td><td>${r.rating}/5</td><td style="white-space:normal;min-width:240px">${esc(r.comment || '—')}</td>
    <td><button class="ghost" data-act="delreview">Delete</button></td></tr>`));
  $('#audit').innerHTML = table(['Time', 'Administrator', 'Action', 'Target'], d.audit.map(entry =>
    '<tr><td>' + fmt(entry.t) + '</td><td>' + esc(entry.admin) + '</td><td>' + esc(entry.action) + '</td><td>' + esc(entry.target) + '</td></tr>'));
  $('#orders').innerHTML = table(['Time', 'Type', 'What', 'Who', 'Amount', 'Paid'], d.orders.map(o => `
    <tr><td>${fmt(o.createdAt)}</td><td>${esc(o.type)}</td><td>${esc(o.what)}</td><td>${esc(o.who)}</td><td>${o.amount} ₾</td><td>${o.paid ? '✓' : '✗'}</td></tr>`));
  for (const id of ['users', 'sites', 'reviews', 'audit', 'orders']) {
    const table = $('#' + id);
    paginate(table.parentElement, $('#' + id + '-pages'), [...table.rows].slice(1), 6);
  }
}
$('#logout').onclick = async () => { await dropSession(); load(); };
document.querySelector('main').onclick = async e => {
  const t = e.target, act = t.dataset.act, tr = t.closest('tr'); if (!act || !tr) return;
  try {
    if (act === 'grant') await api(`/admin/users/${tr.dataset.id}/plan`, 'POST', { plan: tr.querySelector('select').value, days: 30 });
    else if (act === 'del' && confirm('Delete this user and their sites?')) await api(`/admin/users/${tr.dataset.id}`, 'DELETE');
    else if (act === 'delsite' && confirm('Delete this site?')) await api(`/admin/sites/${tr.dataset.id}`, 'DELETE');
    else if (act === 'delreview' && confirm('Delete this review?')) await api(`/admin/reviews/${tr.dataset.id}`, 'DELETE');
    else return;
    load();
  } catch (err) { alert(err.message); }
};
load();

mountPrefs();
window.addEventListener('langchange', load);
