import './styles/main.css';
import './form-validation.js';
import './styles/auth.css';
import './styles/app.css';
import './styles/studio.css';
import { api } from './api/client.js';
import { t } from './i18n.js';
import { mountPrefs } from './prefs.js';
import { mountPassword } from './password.js';
const $ = s => document.querySelector(s);
mountPassword($('#np'), $('#np2'));
const token = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', location.pathname);
$('#rForm').onsubmit = async e => {
  e.preventDefault(); $('#rMsg').textContent = '';
  if ($('#np').value !== $('#np2').value) return ($('#rMsg').textContent = t('Passwords do not match'));
  try { await api('/reset', 'POST', { token, password: $('#np').value }); $('#rForm').hidden = true; $('#done').hidden = false; }
  catch (err) { $('#rMsg').textContent = err.message; }
};
mountPrefs();
