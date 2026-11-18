import './styles/main.css';
import './form-validation.js';
import './styles/auth.css';
import './styles/app.css';
import './styles/studio.css';
import { mountViews } from './views.js';
import { paginate } from './pager.js';
import { api, esc, hasSession } from './api/client.js';
import { t, getLang } from './i18n.js';
import { mountPrefs } from './prefs.js';

const $ = s => document.querySelector(s);
mountViews($('#main'), { hash: true });
const USED = [['scan', 'Free scan'], ['pdf', 'PDF report'], ['code', 'Fix code'], ['monitoring', 'Monitoring'], ['sms', 'SMS alerts'], ['email', 'Email alerts']];
const label = Object.fromEntries(USED), tok = hasSession();
let rating = 0, mine = false;
$('#used').innerHTML = USED.map(([k, l]) => `<label class="chk"><input type="checkbox" value="${k}"> ${l}</label>`).join('');

function drawStars() {
  $('#stars').innerHTML = [1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${rating === n}" aria-label="${t('{0} out of 5', n)}" data-n="${n}" class="${n <= rating ? 'on' : ''}">★</button>`).join('');
}
$('#stars').onclick = e => { const b = e.target.closest('[data-n]'); if (b) { rating = +b.dataset.n; drawStars(); } };

async function load() {
  const d = await api('/reviews');
  $('#summary').textContent = d.count ? t('{0} / 5 · {1} reviews', d.avg, d.count) : '';
  const loc = getLang() === 'ka' ? 'ka-GE' : 'en-GB';
  $('#list').innerHTML = d.reviews.length ? d.reviews.map(r => `
    <article class="rcard"><div class="rtop"><b>${esc(r.name)}</b>
      <span class="rstars" role="img" aria-label="${t('{0} out of 5', r.rating)}">${'★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)} <span class="num">${r.rating}/5</span></span>
      <small>${new Date(r.createdAt).toLocaleDateString(loc)}</small></div>
      ${r.used.length ? `<div class="tags">${r.used.map(k => `<span class="chip">${esc(t(label[k]))}</span>`).join('')}</div>` : ''}
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}</article>`).join('') : `<p class="muted">${t('No reviews yet. Be the first!')}</p>`;
  const list = $('#list');
  paginate(list, $('#reviewPages'), [...list.querySelectorAll('article')], matchMedia('(max-width: 650px)').matches ? 2 : 4);
}
const btnText = () => $('#rvBtn').textContent = t(mine ? 'Update review' : 'Send review');

async function init() {
  if (!tok) $('#loginNote').hidden = false;
  else {
    $('#revForm').hidden = false;
    const m = await api('/reviews/mine').catch(() => null);
    if (m) { mine = true; rating = m.rating; document.querySelectorAll('#used input').forEach(i => i.checked = m.used.includes(i.value)); $('#comment').value = m.comment; btnText(); }
  }
  drawStars(); load();
}
$('#revForm').onsubmit = async e => {
  e.preventDefault(); const msg = $('#rvMsg'); msg.textContent = '';
  try {
    await api('/reviews', 'POST', { rating, used: [...document.querySelectorAll('#used input:checked')].map(i => i.value), comment: $('#comment').value });
    mine = true; btnText(); msg.style.color = 'var(--ok)'; msg.textContent = t('Thank you for your review!'); load();
  } catch (err) { msg.style.color = 'var(--bad)'; msg.textContent = err.message; }
};
window.addEventListener('langchange', () => { drawStars(); load(); btnText(); });
mountPrefs(); init();
