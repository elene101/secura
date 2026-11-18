import { requirePasskeySupport, createPasskey, usePasskey } from './passkey.js';
import './styles/main.css';
import './form-validation.js';
import './styles/auth.css';
import './styles/app.css';
import './styles/studio.css';
import { mountViews } from './views.js';
import { api, esc, dropSession } from './api/client.js';
import { mountPassword } from './password.js';
import { OPTIONS } from './options.js';
import { toJpeg } from './api/avatar.js';
import { t, getLang } from './i18n.js';
import { verificationMessage } from './account-mail.js';
import { mountPrefs } from './prefs.js';

const $ = s => document.querySelector(s);
const updatePasswordRules = mountPassword($('#newPw'));
const profileFields = ['firstName', 'lastName', 'company', 'companyType', 'companySize', 'role'];
mountViews($('#main'), { hash: true });
for (const tab of document.querySelectorAll('[data-security]')) {
  tab.onclick = () => {
    $('#secCard').dataset.securityMode = tab.dataset.security;
    for (const button of document.querySelectorAll('[data-security]')) button.setAttribute('aria-pressed', button === tab);
  };
}
const msg = (t, bad) => { $('#pMsg').textContent = t; $('#pMsg').style.color = bad ? 'var(--bad)' : 'var(--ok)'; };
for (const k of Object.keys(OPTIONS)) $('#' + k).innerHTML = '<option value="">Not set</option>' + OPTIONS[k].map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
const paint = me => $('#bigAvatar').innerHTML = me.avatar ? `<img src="${esc(me.avatar)}" alt="">` : esc((me.firstName || me.email)[0].toUpperCase());

(async () => {
  let me; try { me = await api('/me'); } catch { return (location.href = '/auth.html'); }
  if (me.onboardingPending) return location.replace('/auth.html?setup');
  initSecurity(me);
  paint(me); $('#verNotice').hidden = me.emailVerified; $('#curLabel').hidden = !me.hasPassword;
  for (const k of profileFields) $('#' + k).value = me[k];
  $('#phone').value = !me.phone ? '' : me.phone.startsWith('995') ? me.phone.slice(3) : '+' + me.phone;
  $('#accountName').textContent = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.email;
  $('#emailLine').textContent = me.email + (me.provider ? ' · ' + me.provider[0].toUpperCase() + me.provider.slice(1) : '');
  $('#planLine').textContent = me.plan.id !== 'free' && me.planUntil ? t('Plan: {0} (until {1})', t(me.plan.name), new Date(me.planUntil).toLocaleDateString(getLang() === 'ka' ? 'ka-GE' : 'en-GB')) : t('Plan: {0}', t(me.plan.name));
})();

$('#pForm').onsubmit = async e => {
  e.preventDefault(); msg('');
  try {
    const body = {}; for (const k of profileFields) body[k] = $('#' + k).value;
    await api('/profile', 'PUT', body);
    const me = await api('/me');
    initSecurity(me);
    $('#accountName').textContent = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.email;
    msg(t('Saved'));
  } catch (err) { msg(err.message, true); }
};
$('#pickPhoto').onclick = () => $('#photo').click();
$('#photo').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const r = await api('/profile/avatar', 'POST', { image: await toJpeg(f) }); paint({ avatar: r.avatar }); msg('Photo updated'); }
  catch (err) { msg(err.message, true); }
};
$('#logout').onclick = async () => { await dropSession(); location.href = '/'; };

mountPrefs();

$('#resendBtn').onclick = async () => {
  try {
    await api('/verify-email/resend', 'POST');
    initSecurity(await api('/me'));
  } catch (err) { msg(err.message, true); }
};
$('#pwForm').onsubmit = async e => {
  e.preventDefault(); const m = $('#pwMsg'); m.textContent = '';
  try {
    await api('/password', 'POST', { current: $('#curPw').value, next: $('#newPw').value });
    $('#curPw').value = '';
    $('#newPw').value = '';
    $('#newPw').type = 'password';
    updatePasswordRules();
    $('#curLabel').hidden = false;
    initSecurity(await api('/me'));
    m.style.color = 'var(--ok)'; m.textContent = t('Password changed');
  } catch (err) { m.style.color = 'var(--bad)'; m.textContent = err.message; }
};
$('#logoutAll').onclick = async () => {
  if (!confirm(t('Log out of all devices?'))) return;
  try { await api('/logout-all', 'POST'); } catch {}
  location.href = '/';
};

let securityProfile;
function showState(id, text, state) {
  $(id).textContent = t(text);
  if (state) $(id).dataset.state = state;
}
function initSecurity(me) {
  securityProfile = me;
  $('#verNotice').hidden = me.emailVerified;
  $('#verifyMessage').textContent = verificationMessage(me);
  showState('#smsState', me.phoneVerified ? 'Mobile number verified.' : 'Mobile number is unverified.', me.phoneVerified ? 'accepted' : 'unknown');
  const usingPasskey = me.mfaMethod === 'passkey';
  const status = usingPasskey ? 'Passkey protection is enabled.' : me.mfaEnabled ? 'MFA is enabled.' : 'MFA is not set up.';
  showState('#mfaState', status, me.mfaEnabled ? 'accepted' : 'unknown');
  const migrating = me.mfaMethod === 'totp';
  $('#mfaSetup').hidden = usingPasskey;
  $('#mfaSetupAction').textContent = t(migrating ? 'Switch to a passkey' : 'Set up a passkey');
  $('#mfaMigrationCode').hidden = !migrating;
  $('#mfaSetup').elements.code.required = migrating;
  $('#mfaDisable').elements.code.required = me.mfaEnabled && !usingPasskey;
  const label = t(usingPasskey ? 'Recovery code (optional, otherwise use passkey)' : 'Security code');
  $('#disableMfaLabel').textContent = label;
  $('#deleteMfaLabel').textContent = label;
  $('#deactivateMfaLabel').textContent = label;
  $('#deactivateMfa').hidden = !me.mfaEnabled;
  $('#mfaDisable').hidden = !me.mfaEnabled || me.isAdmin;
  $('#deleteMfa').hidden = !me.mfaEnabled;
  for (const field of document.querySelectorAll('[data-password]')) field.hidden = !me.hasPassword;
}
function submitForm(form, target, operation) {
  $(form).onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    if (button) button.disabled = true;
    try { await operation(Object.fromEntries(new FormData(event.currentTarget))); }
    catch (error) { showState(target, error.message, 'failed'); }
    finally { if (button) button.disabled = false; }
  };
}
async function savePhone() {
  await api('/profile', 'PUT', { phone: $('#phone').value });
  initSecurity(await api('/me'));
}

submitForm('#phoneForm', '#smsState', async () => {
  await savePhone();
  $('#smsForm').hidden = true;
  showState('#smsState', 'Number saved.', 'accepted');
});
$('#sendPhone').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const phone = $('#phone').value.trim();
    if (!phone) { $('#phone').focus(); throw new Error(t('Enter a mobile number')); }
    await savePhone();
    await api('/account/phone/send', 'POST', { phone });
    $('#smsForm').hidden = false;
    showState('#smsState', 'Verification code sent.', 'queued');
    $('#smsForm').elements.code.focus();
  } catch (error) { showState('#smsState', error.message, 'failed'); }
  finally { button.disabled = false; }
};
submitForm('#smsForm', '#smsState', async body => {
  await api('/account/phone/verify', 'POST', body);
  $('#smsForm').reset();
  $('#smsForm').hidden = true;
  initSecurity(await api('/me'));
});
submitForm('#mfaSetup', '#mfaState', async body => {
  requirePasskeySupport();
  const options = await api('/account/mfa/passkey/setup', 'POST', body);
  const result = await api('/account/mfa/passkey/enable', 'POST', { response: await createPasskey(options) });
  $('#mfaSetup').reset();
  $('#recoveryCodes').textContent = result.recovery.join('\n');
  $('#mfaRecovery').hidden = false;
  initSecurity(await api('/me'));
});

async function accountMfa(body, purpose) {
  if (securityProfile.mfaMethod !== 'passkey' || body.code?.trim()) return body;
  requirePasskeySupport();
  const options = await api('/account/mfa/passkey/account-options', 'POST', { purpose });
  return { ...body, response: await usePasskey(options) };
}
submitForm('#mfaDisable', '#mfaState', async body => {
  if (!confirm(t('Disable two-factor authentication?'))) return;
  await api('/account/mfa/disable', 'POST', await accountMfa(body, 'disable'));
  $('#mfaDisable').reset();
  $('#mfaRecovery').hidden = true;
  $('#recoveryCodes').textContent = '';
  initSecurity(await api('/me'));
});
submitForm('#deactivateAccount', '#deactivateState', async body => {
  if (!confirm(t('Deactivate your account and pause its monitors?'))) return;
  await api('/account/deactivate', 'POST', await accountMfa(body, 'deactivate'));
  location.replace('/auth.html#deactivated=1');
});
submitForm('#deleteAccount', '#accountState', async body => {
  if (!confirm(t('Permanently delete your account and monitored sites?'))) return;
  await api('/account', 'DELETE', await accountMfa(body, 'delete'));
  location.replace('/');
});
window.addEventListener('langchange', () => { if (securityProfile) initSecurity(securityProfile); });
