import './styles/main.css';
import './styles/auth.css';
import './styles/app.css';
import './styles/studio.css';
import { api } from './api/client.js';
import { t } from './i18n.js';
import { mountPrefs } from './prefs.js';
const $ = s => document.querySelector(s);
const token = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', location.pathname); // ტოკენს მისამართიდან მაშინვე ვშლით
const button = $('#confirmEmail');
const status = $('#vMsg');
const link = $('#confirmedLink');
if (!token) {
  button.hidden = true;
  status.style.color = 'var(--bad)';
  status.textContent = t('This confirmation link is invalid or has expired.');
}
button.onclick = async () => {
  button.disabled = true;
  try {
    const result = await api('/verify-email', 'POST', { token });
    status.style.color = 'var(--ok)';
    status.textContent = t(result.pending && !result.signedIn
      ? 'Email confirmed. Return to the device or browser where you started signing in.'
      : 'Your email is confirmed. Thank you!');
    link.href = result.signedIn ? '/dashboard.html' : '/auth.html';
    link.hidden = result.pending && !result.signedIn;
    button.hidden = true;
  } catch (error) {
    status.style.color = 'var(--bad)';
    status.textContent = error.message;
  } finally { button.disabled = false; }
};
mountPrefs();
