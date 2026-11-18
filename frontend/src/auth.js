import './styles/main.css';
import { clearFieldError, showFieldError, validateFields } from './form-validation.js';
import './styles/auth.css';
import './styles/studio.css';
import { api, dropSession, hasSession } from './api/client.js';
import { getLang, t } from './i18n.js';
import { mountPrefs } from './prefs.js';
import { requirePasskeySupport, usePasskey } from './passkey.js';
import { mountPassword } from './password.js';
import { fillOptions, OPTIONS } from './options.js';

const $ = selector => document.querySelector(selector);
const dashboard = () => location.replace('/dashboard.html');
const mobileFormat = 'Enter a mobile number with country code (e.g. +44 7700 900123) or a Georgian number (599123456)';
mountPassword($('#rPass'));
const setupForm = $('#setupForm'), fields = setupForm.elements;
const regForm = $('#regForm'), regFields = regForm.elements;
const credentials = [regFields.firstName, regFields.lastName, regFields.email, regFields.password];
let regStep = 1;
let step = 1;
let setupEmail;

function paintCompanyOptions(form) {
  const fields = form.elements;
  for (const [name, label] of [
    ['companyType', 'Choose your company type'], ['companySize', 'Choose size'], ['role', 'Choose your role']
  ]) {
    const value = fields[name].value;
    fillOptions(fields[name], OPTIONS[name], label, t);
    fields[name].value = value;
  }
}
function updateCompanyFields(form) {
  const { companyType, company, companySize } = form.elements;
  const chosen = !!companyType.value;
  const personal = ['Individual', 'Freelancer'].includes(companyType.value);
  form.querySelector('[data-company-fields]').hidden = !chosen;
  form.querySelector('[data-company-name]').textContent = t(personal ? 'Company name (optional)' : 'Company name');
  company.disabled = companySize.disabled = !chosen;
  company.required = chosen && !personal;
  companySize.required = chosen;
  if (personal && !companySize.value) companySize.value = 'Just me';
  if (!company.required) clearFieldError(company);
  if (!chosen || companySize.value) clearFieldError(companySize);
}
function showRegistrationStep(next, focus = false) {
  regStep = next;
  $('#regPersonal').hidden = $('#regProviders').hidden = $('#regLoginPrompt').hidden = next === 2;
  $('#regWork').hidden = $('#regWork').disabled = next !== 2;
  $('#vReg').dataset.step = String(next);
  $('#regStep').textContent = t(next === 1 ? 'Step 1 of 2' : 'Step 2 of 2');
  if (focus) (next === 1 ? regFields.firstName : regFields.companyType).focus();
}
function showStep(next, focus = false) {
  step = next;
  $('#setupPersonal').hidden = step !== 1;
  $('#setupWork').hidden = step !== 2;
  $('#vSetup').dataset.step = String(step);
  $('#setupStep').textContent = t(step === 1 ? 'Step 1 of 2' : 'Step 2 of 2');
  if (focus) (step === 1 ? fields.firstName : fields.companyType).focus();
}
function startSetup(profile) {
  setupEmail = profile.email;
  $('#setupEmail').textContent = setupEmail;
  for (const field of ['firstName', 'lastName', 'companyType', 'companySize', 'company', 'role', 'phone']) {
    fields[field].value = profile[field] || '';
  }
  if (profile.phone) fields.phone.value = '+' + profile.phone;
  updateCompanyFields(setupForm);
  show('Setup');
  showStep(1, true);
}
async function continueSession() {
  const profile = await api('/me');
  if (!profile.onboardingPending) return dashboard();
  const invite = sessionStorage.getItem('secura_invite');
  if (invite && /^[a-f0-9]{48}$/.test(invite) && invite !== profile.pending?.invite) {
    await api('/dashboard/draft', 'PUT', { invite }).catch(() => {});
  }
  startSetup(profile);
}
function checkPersonal() {
  const names = [fields.firstName, fields.lastName];
  for (const field of names) field.value = field.value.trim();
  return validateFields(names);
}
for (const form of [setupForm, regForm]) {
  paintCompanyOptions(form);
  form.elements.companyType.addEventListener('change', () => updateCompanyFields(form));
}
$('#regBack').onclick = () => {
  $('#rErr').textContent = '';
  showRegistrationStep(1, true);
};
$('#setupNext').onclick = () => { if (checkPersonal()) showStep(2, true); };
$('#setupBack').onclick = () => { $('#setupError').textContent = ''; showStep(1, true); };
$('#setupLogout').onclick = async () => { await dropSession(); location.replace('/auth.html'); };
$('#setupPersonal').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('input')) {
    event.preventDefault();
    $('#setupNext').click();
  }
});

let currentView;
function show(view) {
  currentView = view;
  for (const name of ['Login', 'Forgot', 'Reg', 'Mfa', 'Setup', 'Confirm']) $('#v' + name).hidden = name !== view;
}
function submit(form, feedback, run) {
  $(form).onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    if (button?.disabled || event.currentTarget.dataset.submitting) return;
    event.currentTarget.dataset.submitting = 'true';
    const currentForm = event.currentTarget;
    if (button) button.disabled = true;
    $(feedback).textContent = '';
    try { await run(event.currentTarget); }
    catch (error) { $(feedback).textContent = error.message; }
    finally {
      delete currentForm.dataset.submitting;
      if (button) button.disabled = false;
    }
  };
}
document.querySelectorAll('[data-go]').forEach(link => {
  link.onclick = event => { event.preventDefault(); show(link.dataset.go); };
});
document.querySelectorAll('[data-provider]').forEach(button => {
  button.onclick = async () => {
    try { location.href = (await api('/auth/' + button.dataset.provider + '/url')).url; }
    catch (error) { $($('#vReg').hidden ? '#lErr' : '#rErr').textContent = error.message; }
  };
});

let checkingEmail = false;
let emailMessage = 'Open the confirmation link we sent to your email, then return to this tab.';
async function checkEmailConfirmation(report = false) {
  if (checkingEmail || currentView !== 'Confirm') return;
  checkingEmail = true;
  try {
    if (hasSession()) {
      try { await continueSession(); return; }
      catch (error) { if (error.status !== 401) throw error; }
    }
    const result = await api('/email-session', 'POST');
    if (result.signedIn) return await continueSession();
    emailMessage = !result.pending ? 'This sign-in has expired. Return to log in.'
      : result.failed ? 'The email could not be delivered. Try resending it.'
      : result.retrying ? 'Email delivery is being retried.'
      : result.reactivation ? 'Confirm account reactivation from your email, then return to this tab.'
      : 'Open the confirmation link we sent to your email, then return to this tab.';
    $('#confirmInstructions').textContent = t(emailMessage);
    $('#resendConfirmation').hidden = !result.pending;
    $('#checkConfirmation').hidden = !result.pending;
  } catch (error) {
    if (report) $('#confirmError').textContent = error.message;
  } finally { checkingEmail = false; }
}
function showEmailConfirmation() {
  history.replaceState(null, '', location.pathname + '?confirm');
  show('Confirm');
  checkEmailConfirmation(true);
}
$('#checkConfirmation').onclick = () => checkEmailConfirmation(true);
$('#resendConfirmation').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;
  $('#confirmError').textContent = '';
  try {
    await api('/email-session/resend', 'POST');
    await checkEmailConfirmation(true);
  } catch (error) { $('#confirmError').textContent = error.message; }
  finally { button.disabled = false; }
};
$('#cancelConfirmation').onclick = async event => {
  event.preventDefault();
  await dropSession();
  location.replace('/auth.html');
};
window.addEventListener('focus', () => checkEmailConfirmation());
setInterval(() => { if (!document.hidden) checkEmailConfirmation(); }, 5000);

function showMfa(method) {
  const passkey = method === 'passkey';
  $('#mfaAppHelp').hidden = passkey;
  $('#mfaPasskeyLogin').hidden = !passkey;
  $('#mfaLogin').hidden = passkey;
  $('#mfaCodeLabel').textContent = t(passkey ? 'Recovery code' : 'Security code');
  $('#mfaErr').textContent = '';
  show('Mfa');
}
$('#mfaUsePasskey').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;
  $('#mfaErr').textContent = '';
  try {
    requirePasskeySupport();
    const options = await api('/account/mfa/passkey/login-options', 'POST');
    await api('/account/mfa/passkey/login', 'POST', { response: await usePasskey(options) });
    showEmailConfirmation();
  } catch (error) {
    $('#mfaErr').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
$('#mfaUseRecovery').onclick = () => {
  $('#mfaLogin').hidden = false;
  $('#mfaLogin').elements.code.focus();
};

submit('#loginForm', '#lErr', async () => {
  const result = await api('/login', 'POST', { email: $('#lEmail').value, password: $('#lPass').value });
  if (result.mfa) showMfa(result.method);
  else showEmailConfirmation();
});
submit('#regForm', '#rErr', async form => {
  for (const field of credentials.slice(0, 3)) field.value = field.value.trim();
  if (credentials.some(field => !field.validity.valid)) {
    showRegistrationStep(1);
    validateFields(credentials);
    return;
  }
  if (regStep === 1) {
    showRegistrationStep(2, true);
    return;
  }
  regFields.company.value = regFields.company.value.trim();
  if (!validateFields([regFields.companyType, regFields.company, regFields.companySize, regFields.role])) return;
  const details = Object.fromEntries(new FormData(form));
  try {
    await api('/register', 'POST', { ...details, lang: getLang() });
  } catch (error) {
    const messages = [
      ['This email is already registered', regFields.email],
      ['Check your email address', regFields.email],
      ['Choose a less predictable password.', regFields.password],
      ['Use 10–128 characters, an uppercase letter and a special character.', regFields.password],
      [mobileFormat, regFields.phone]
    ];
    const field = messages.find(([message]) => error.message === t(message))?.[1];
    if (field) {
      showRegistrationStep(1);
      showFieldError(field, error.message);
      field.focus();
      return;
    }
    throw error;
  }
  showEmailConfirmation();
});
submit('#forgotForm', '#fMsg', async () => {
  await api('/forgot', 'POST', { email: $('#fEmail').value });
  $('#fMsg').textContent = t('If an account exists, we’ll try to email a reset link. Check your inbox and spam folder.');
});
submit('#mfaLogin', '#mfaErr', async form => {
  await api('/account/mfa/challenge', 'POST', { code: form.elements.code.value });
  showEmailConfirmation();
});

submit('#setupForm', '#setupError', async form => {
  if (step === 1) return $('#setupNext').click();
  if (!fields.firstName.value.trim() || !fields.lastName.value.trim()) {
    showStep(1, true);
    checkPersonal();
    return;
  }
  if (!fields.company.disabled) {
    fields.company.value = fields.company.value.trim();
    if (!validateFields([fields.company])) return;
  }
  const details = Object.fromEntries(new FormData(form));
  try {
    await api('/account/onboarding', 'POST', { ...details, lang: getLang() });
  } catch (error) {
    if (details.phone && error.message === t(mobileFormat)) {
      showStep(1);
      showFieldError(fields.phone, error.message);
      fields.phone.focus();
      return;
    }
    throw error;
  }
  dashboard();
});

const fragment = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, '', location.pathname + location.search);
mountPrefs();
if (fragment.get('mfa')) showMfa(fragment.get('mfa'));
else if (new URLSearchParams(location.search).has('confirm')) showEmailConfirmation();
else if (fragment.get('done') || new URLSearchParams(location.search).has('setup') || hasSession()) {
  continueSession().catch(error => { show('Login'); $('#lErr').textContent = error.message; });
}
else {
  show(new URLSearchParams(location.search).has('signup') ? 'Reg' : 'Login');
  if (fragment.get('error')) $('#lErr').textContent = t(fragment.get('error'));
  if (fragment.get('deactivated')) $('#lErr').textContent = t('Your account is deactivated. Sign in to reactivate it.');
}

window.addEventListener('langchange', () => {
  if (currentView) show(currentView);
  if (currentView === 'Confirm') $('#confirmInstructions').textContent = t(emailMessage);
  paintCompanyOptions(regForm);
  updateCompanyFields(regForm);
  showRegistrationStep(regStep);
  if (setupEmail) {
    paintCompanyOptions(setupForm);
    updateCompanyFields(setupForm);
    showStep(step);
  }
});
