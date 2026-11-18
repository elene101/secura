import { t } from '../i18n.js';
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// სესიის cookie httpOnly-ა და JavaScript-ს არ ეჩვენება. ჩვენ ვხედავთ მხოლოდ CSRF cookie-ს, რომელიც იმავე დროს იქმნება და ქრება
const csrf = () => (document.cookie.match(/(?:^|; )(?:__Host-)?sg_csrf=([^;]*)/) || [])[1] || '';
export const hasSession = () => !!csrf();
export const api = async (path, method = 'GET', body) => {
  const headers = { 'Content-Type': 'application/json' }, c = csrf(); if (c) headers['X-CSRF-Token'] = c;
  const r = await fetch('/api' + path, { method, headers, credentials: 'same-origin', body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(t(j.error || 'Something went wrong'));
    error.status = r.status;
    throw error;
  }
  return j;
};
export const dropSession = async () => { try { await api('/logout', 'POST'); } catch {} };
