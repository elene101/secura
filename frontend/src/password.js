import { t } from './i18n.js';
import { clearFieldError } from './form-validation.js';

const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*_-+=?'];

function randomIndex(limit) {
  const sample = new Uint8Array(1);
  const cutoff = 256 - (256 % limit);
  do { crypto.getRandomValues(sample); } while (sample[0] >= cutoff);
  return sample[0] % limit;
}

export function generatePassword() {
  const alphabet = groups.join('');
  const pick = characters => characters[randomIndex(characters.length)];
  const password = [...groups.map(pick), ...Array.from({ length: 16 }, () => pick(alphabet))];
  for (let index = password.length - 1; index > 0; index--) {
    const swap = randomIndex(index + 1);
    [password[index], password[swap]] = [password[swap], password[index]];
  }
  return password.join('');
}

export function mountPassword(input, confirmation) {
  const field = input.closest('label');
  const panel = document.createElement('div');
  panel.className = 'password-tools';
  panel.innerHTML = '<div class="password-actions"><button type="button" class="ghost" data-generate></button>' +
    '<button type="button" class="ghost" data-reveal aria-pressed="false"></button></div>' +
    '<ul class="password-rules"></ul><p class="password-status" role="status"></p>';
  field.after(panel);
  const rules = panel.querySelector('.password-rules');
  rules.id = input.id + '-rules';
  input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), rules.id].filter(Boolean).join(' '));
  const generate = panel.querySelector('[data-generate]');
  const reveal = panel.querySelector('[data-reveal]');
  const status = panel.querySelector('.password-status');

  function paint() {
    const value = input.value;
    const met = [[...value].length >= 10 && value.length <= 128, /\p{Lu}/u.test(value), /[\p{P}\p{S}]/u.test(value)];
    const labels = ['10–128 characters', 'One uppercase letter', 'One special character'];
    rules.replaceChildren(...labels.map((label, index) => {
      const item = document.createElement('li');
      item.dataset.met = String(met[index]);
      item.textContent = t(label);
      item.setAttribute('aria-label', t(label) + ', ' + t(met[index] ? 'met' : 'not met'));
      return item;
    }));
    input.setCustomValidity(!value || met.every(Boolean) ? '' : t('Use 10–128 characters, an uppercase letter and a special character.'));
    generate.textContent = t('Suggest strong password');
    const shown = input.type === 'text';
    reveal.textContent = t(shown ? 'Hide password' : 'Show password');
    reveal.setAttribute('aria-pressed', shown);
  }

  input.addEventListener('input', () => { status.textContent = ''; paint(); });
  reveal.onclick = () => { input.type = input.type === 'password' ? 'text' : 'password'; paint(); };
  generate.onclick = () => {
    input.value = generatePassword();
    clearFieldError(input);
    if (confirmation) {
      confirmation.value = input.value;
      clearFieldError(confirmation);
    }
    status.textContent = t('A strong password was filled in.');
    paint();
  };
  window.addEventListener('langchange', paint);
  paint();
  return paint;
}
