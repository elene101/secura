import './styles/main.css';
import './form-validation.js';
import './styles/app.css';
import './styles/studio.css';
import { mountViews } from './views.js';
import { api, esc, hasSession, dropSession } from './api/client.js';
import { t, getLang, applyLang } from './i18n.js';
import { mountPrefs } from './prefs.js';

const $ = s => document.querySelector(s);
const landing = mountViews(document.body, { hash: true });
const resultViews = mountViews($('.result-detail'));
const menu = $('#mobileMenu');
function setMenu(open) { menu.setAttribute('aria-expanded', open); }
menu.onclick = () => setMenu(menu.getAttribute('aria-expanded') !== 'true');
document.addEventListener('click', event => {
  if (!event.target.closest('.lbar') || event.target.closest('#mainNav a')) setMenu(false);
});
$('#mainNav').addEventListener('click', event => {
  if (menu.getAttribute('aria-expanded') === 'true' && event.target.closest('[data-tab]')) {
    setMenu(false);
    menu.focus();
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    menu.focus();
  }
});
if (landing.current() === 'result') landing.show('scan');
window.addEventListener('hashchange', () => {
  if (landing.current() === 'result' && !last) landing.show('scan');
});
let checkout = false;
let plans = [], picked = 'start', curPlan = 'free', last = null, authed = hasSession();
let reportLang = getLang(); // PDF-ის ენა (ნაგულისხმევად საიტის ენა, მაგრამ შეიძლება შეიცვალოს)

const CHK = {
  redirect: 'HTTP to HTTPS', cookies: 'Cookie settings', disclosure: 'Server version disclosure',
  mixed: 'Mixed content', dkim: 'DKIM', spf: 'SPF', dmarc: 'DMARC', securitytxt: 'security.txt', domain: 'Domain expiry'
};
// ---------- სკანირება ----------
$('#scanForm').onsubmit = async e => {
  e.preventDefault(); $('#msg').textContent = ''; const b = e.submitter; b.disabled = true; b.textContent = t('Scanning…');
  try {
    show(last = await api('/scan', 'POST', { url: $('#url').value }));
    $('#resultTab').hidden = false;
    resultViews.show('checks');
    landing.show('result', { updateHash: true });
    $('#rHost').focus({ preventScroll: true });
  }
  catch (err) { $('#msg').textContent = err.message; }
  b.disabled = false; b.textContent = t('Scan');
};
function show(r) {
  $('#result').classList.add('on');
  $('#rHost').textContent = r.host;
  $('#score').textContent = r.score ?? '—';
  $('#reputationResult').textContent = '';
  $('#rEvidence').textContent = r.finalUrl ? t('Final URL: {0}', r.finalUrl) : t('No HTTP response received.');
  $('#rCoverage').textContent = r.score == null ? t('Score unavailable for this response.') : t('Measured checks account for {0} of {1} points.', r.coverage?.measured, r.coverage?.possible);
  const arc = $('#arc'); arc.style.stroke = r.score >= 75 ? 'var(--ok)' : r.score >= 45 ? 'var(--warn)' : 'var(--bad)';
  requestAnimationFrame(() => arc.style.strokeDashoffset = 490 * (1 - (r.score || 0) / 100));
  $('#rStatus').textContent = r.up ? t('Up (HTTP {0})', r.status) : r.status ? t('Unexpected or insecure response (HTTP {0})', r.status) : t('Down');
  $('#rMs').textContent = r.status ? r.responseMs + ' ms' : '—';
  $('#rSsl').textContent = r.ssl.ok ? t('valid, {0} days left', r.ssl.days) : t('Problem: {0}', t(r.ssl.error || 'invalid certificate'));
  const chip = (ok, text, classification) => {
    const state = ok === true ? 'Passed' : ok === false ? 'Issue found' : classification === 'not_applicable' ? 'Not applicable' : 'Not measured';
    return '<span class="chip ' + (ok === true ? 'y' : ok === false ? 'n' : 'na') + '">' + esc(text) + ' · ' + esc(t(state)) + '</span>';
  };
  $('#rHdrs').innerHTML = r.headers.map(h => chip(h.present, h.label)).join('') + (r.checks || []).map(c => chip(c.ok, t(CHK[c.id]), c.state)).join('');
  const tips = [];
  if (!r.ssl.ok) tips.push('Check your TLS certificate validity, hostname and certificate chain.');
  if (r.headers.some(h => h.present === false)) tips.push('Review the missing browser security headers in your web server configuration.');
  if (r.checks?.some(c => c.id === 'mixed' && c.ok === false)) tips.push('Load page resources over HTTPS to remove mixed content.');
  if (r.checks?.some(c => (c.id === 'spf' || c.id === 'dmarc') && c.ok === false)) tips.push('Review SPF and DMARC with your email provider.');
  if (r.checks?.some(c => c.id === 'domain' && c.ok === false)) tips.push('Check your domain renewal date with your registrar.');
  if (r.checks?.some(c => c.id === 'dkim' && c.ok == null)) tips.push('DKIM detection checks common selectors. Check the selector configured by your mail provider.');
  if (!tips.length) tips.push('No priority fixes were identified by these checks.');
  $('#rFindings').innerHTML = tips.map(tip => '<li>' + esc(t(tip)) + '</li>').join('');
}
$('#reputationBtn').onclick = async () => {
  if (!last) return;
  const current = last, button = $('#reputationBtn'), target = $('#reputationResult');
  button.disabled = true;
  delete target.dataset.state;
  target.textContent = t('Loading…');
  try {
    const result = await api('/reputation', 'POST', { url: current.url });
    if (last !== current) return;
    const domainOnly = result.scope === 'domain';
    let finding;
    if (result.status === 'listed') {
      finding = domainOnly ? t('The DNS threat filter blocks this domain.') : t('Listed: {0}', result.matches.join(', '));
    } else if (result.status === 'no_match') {
      finding = domainOnly ? t('The DNS threat filter does not block this domain.') : t('No listing was found in this source.');
    } else if (result.status === 'inconclusive') {
      finding = t('The DNS filter could not assess this domain.');
    } else {
      finding = t('Reputation check is temporarily unavailable');
    }
    const scope = domainOnly ? t('Domain only') + ' · ' : '';
    const checked = result.checkedAt ? ' · ' + new Date(result.checkedAt).toLocaleString(getLang() === 'ka' ? 'ka-GE' : 'en-GB') : '';
    target.dataset.state = result.status;
    target.textContent = finding + ' · ' + scope + result.source + checked;
  } catch (error) { if (last === current) target.textContent = error.message; }
  finally { button.disabled = false; }
};
$('#cancelPlan').onclick = async () => {
  if (!confirm(t('Are you sure? The plan ends immediately, remaining days are not refunded and SMS alerts stop.'))) return;
  try { await api('/plans/cancel', 'POST'); await loadDash(); }
  catch (error) { $('#msg').textContent = error.message; }
};

// ---------- PDF ყიდვა: ენა და მზა კოდი ----------
const pdfLabel = () => $('#pdfBtn').textContent = t('Detailed PDF report – {0} ₾', $('#withCode').checked ? 10 : 5);
const syncRl = () => document.querySelectorAll('[data-rl]').forEach(b => b.setAttribute('aria-checked', b.dataset.rl === reportLang));
$('#withCode').onchange = pdfLabel;
document.querySelectorAll('[data-rl]').forEach(b => b.onclick = () => { reportLang = b.dataset.rl; syncRl(); });
$('#pdfBtn').onclick = async () => {
  try {
    const withCode = $('#withCode').checked, price = withCode ? 10 : 5, what = t(withCode ? 'PDF report + fix code' : 'PDF report') + ' – ' + last.host;
    const { orderId, redirectUrl } = await api('/report/order', 'POST', { url: last.url, withCode, lang: reportLang });
    if (redirectUrl) return (location.href = redirectUrl);
    if (!await demoCheckout(what, price)) return;
    await api(`/report/${orderId}/demo-pay`, 'POST');
    location.href = `/api/report/${orderId}/pdf`;
    paySuccess(what, t('Paid {0} ₾ · the report is downloading now', price));
  } catch (err) { alert(err.message); }
};
$('#watchBtn').onclick = async () => {
  if (last?.url) sessionStorage.setItem('secura_pending_url', last.url);
  location.href = authed ? '/dashboard.html' : '/auth.html?signup';
};

// ---------- ანგარიში ----------
$('#authBtn').onclick = async () => {
  if (authed) { await dropSession(); authed = false; return renderAuth(); }
  location.href = '/auth.html';
};
async function renderAuth() {
  $('#authBtn').textContent = t(authed ? 'Log out' : 'Log in');
  $('#signupBtn').hidden = !!authed;
  $('#dashboardLink').hidden = !authed;
  $('#cancelPlan').hidden = true;
  if (!authed) { curPlan = 'free'; renderPlans(); $('#adminLink').hidden = true; $('#profileLink').hidden = true; return; }
  loadDash().catch(async error => {
    if (error.status === 401) { await dropSession(); authed = false; renderAuth(); }
    else $('#msg').textContent = error.message;
  });
}
async function loadDash() {
  const me = await api('/me');
  curPlan = me.plan.id;
  $('#cancelPlan').hidden = me.plan.id === 'free';
  renderPlans();
  $('#adminLink').hidden = !me.isAdmin;
  $('#profileLink').hidden = false;
  $('#dashboardLink').hidden = false;
  $('#profileName').textContent = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.email.split('@')[0];
  $('#profileAv').innerHTML = me.avatar ? '<img src="' + esc(me.avatar) + '" alt="">' : esc((me.firstName || me.email)[0].toUpperCase());
}

// ---------- პაკეტები ----------
async function loadPlans() {
  const [availablePlans, settings] = await Promise.all([api('/plans'), api('/features')]);
  plans = availablePlans;
  checkout = settings.checkout;
  document.querySelectorAll('[data-checkout]').forEach(element => { element.hidden = !checkout; });
  $('#betaPlans').hidden = checkout;
  renderPlans();
}
function renderPlans() {
  $('#plans').innerHTML = plans.map(p => `
    <div class="plan ${p.id === picked ? 'hot' : ''}" data-id="${p.id}">
      <div class="price">${p.price ? p.price + ' ₾<small>' + t('/mo') + '</small>' : t('Free')}</div>
      <b>${esc(t(p.name))}</b>
      <p>${t(p.sites === 1 ? '{0} site · checked every 30 minutes' : '{0} sites · checked every 30 minutes', p.sites)}<br>${t(p.sms ? 'SMS + email alerts' : 'Email alerts only')}</p>
      ${p.price && checkout ? `<button data-buy="${p.id}" ${curPlan === p.id ? 'class="ghost"' : ''}>${t(curPlan === p.id ? 'Extend' : 'Buy')}</button>` : ''}
    </div>`).join('');
}
$('#plans').onclick = async e => {
  const card = e.target.closest('.plan');
  if (card && !e.target.dataset.buy) { picked = card.dataset.id; document.querySelectorAll('.plan').forEach(c => c.classList.toggle('hot', c === card)); return; }
  const plan = e.target.dataset.buy; if (!plan) return;
  if (!authed) return (location.href = '/auth.html?signup');
  try {
    const { orderId, redirectUrl } = await api('/plans/checkout', 'POST', { plan });
    if (redirectUrl) return (location.href = redirectUrl);
    const pl = plans.find(x => x.id === plan);
    if (!await demoCheckout(`Secura GE – ${pl.name} (30 ${t('days')})`, pl.price)) return;
    await api(`/plans/${orderId}/demo-pay`, 'POST'); await loadDash();
    paySuccess(t('{0} plan activated', pl.name), t('Paid {0} ₾ · valid for 30 days', pl.price));
  } catch (err) { alert(err.message); }
};

// ---------- დემო გადახდის ფანჯარა (რეალურ რეჟიმში ბანკის გვერდი გამოიყენება) ----------
$('#cNum').oninput = e => e.target.value = e.target.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
$('#cExp').oninput = e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); e.target.value = v.length > 2 ? v.slice(0, 2) + '/' + v.slice(2) : v; };
function demoCheckout(title, amount) {
  return new Promise(resolve => {
    const dlg = $('#payDlg'), btn = $('#payBtn'); let done = false;
    $('#payTitle').textContent = title; $('#payAmount').textContent = amount + ' ₾';
    btn.textContent = t('Pay {0} ₾', amount); btn.disabled = false;
    const finish = ok => { if (done) return; done = true; dlg.close(); resolve(ok); };
    $('#payForm').onsubmit = async e => {
      e.preventDefault(); btn.disabled = true; btn.textContent = t('Processing…');
      await new Promise(r => setTimeout(r, 1500)); finish(true);
    };
    $('#payClose').onclick = () => finish(false);
    dlg.oncancel = () => finish(false);
    dlg.showModal();
  });
}
function paySuccess(what, text) { $('#okWhat').textContent = what; $('#okText').textContent = text; $('#okDlg').showModal(); }
$('#okBtn').onclick = () => $('#okDlg').close();

// ---------- ბანკიდან დაბრუნება: ?order=ID&kind=plan|report ----------
const q = new URLSearchParams(location.search);
if (q.get('payment') === 'failed') { history.replaceState({}, '', '/'); alert(t('Payment failed')); }
if (q.get('order')) (async () => {
  const oid = q.get('order'), kind = q.get('kind'); history.replaceState({}, '', '/');
  for (let i = 0; i < 10; i++) {
    try {
      if ((await api(`/payments/${oid}/status`)).paid) {
        if (kind === 'report') { location.href = `/api/report/${oid}/pdf`; paySuccess(t('PDF report'), t('The report is downloading now')); }
        else { await loadDash(); paySuccess(t('Plan activated'), t('Valid for 30 days')); }
        return;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  alert(t('Payment not confirmed yet. If you were charged, refresh the page in a few minutes.'));
})();

// ---------- ენის შეცვლა: დინამიკური ნაწილების თავიდან დახატვა ----------
window.addEventListener('langchange', () => {
  reportLang = getLang(); syncRl(); pdfLabel();
  if (last) show(last);
  renderPlans(); renderAuth();
});

mountPrefs();
document.querySelectorAll('[data-checkout]').forEach(element => { element.hidden = true; });
syncRl();
pdfLabel();
renderAuth();
loadPlans().catch(error => { $('#msg').textContent = error.message; });

