// ენისა და თემის გადამრთველები (ჩნდება #prefs ელემენტში)
import { getLang, setLang, applyLang, t } from './i18n.js';
import { api, hasSession } from './api/client.js';
const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>';
export function mountPrefs() {
  const box = document.getElementById('prefs');
  if (box) {
    box.innerHTML = `<div class="seg" role="group" aria-label="Language"><button type="button" data-l="en">EN</button><button type="button" data-l="ka">KA</button></div><button type="button" class="iconbtn" id="themeBtn" aria-label="Switch theme"></button>`;
    const paint = () => {
      box.querySelectorAll('[data-l]').forEach(b => b.setAttribute('aria-pressed', b.dataset.l === getLang()));
      $theme.innerHTML = document.documentElement.dataset.theme === 'light' ? MOON : SUN;
    };
    const $theme = box.querySelector('#themeBtn');
    box.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
      setLang(b.dataset.l); paint();
      if (hasSession()) api('/profile', 'PUT', { lang: b.dataset.l }).catch(() => {}); // ელფოსტა მომხმარებლის ენაზე მივა
    });
    $theme.onclick = () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next; localStorage.setItem('sg_theme', next); paint();
    };
    paint();
  }
  applyLang();
}
