import { t } from './i18n.js';

const errors = new WeakMap();
let nextId = 0;
let pendingFocus;

function fieldMessage(field) {
  const validity = field.validity;
  if (validity.valueMissing) {
    if (field.dataset.requiredMessage) return t(field.dataset.requiredMessage);
    if (field.matches('select')) return t('Choose an option.');
    if (field.type === 'email') return t('Enter your email address.');
    if (field.type === 'password') return t('Enter a password.');
    return t('Fill in this field.');
  }
  if (validity.typeMismatch && field.type === 'email') return t('Enter a valid email address.');
  if (validity.typeMismatch && field.type === 'url') return t('Enter a valid website address.');
  if (validity.customError) return field.validationMessage;
  if (validity.tooShort) return t('Enter at least {0} characters.', field.minLength);
  if (validity.tooLong) return t('Enter no more than {0} characters.', field.maxLength);
  if (validity.rangeUnderflow) return t('Enter a value of at least {0}.', field.min);
  if (validity.rangeOverflow) return t('Enter a value of no more than {0}.', field.max);
  return t('Check the format of this field.');
}

export function clearFieldError(field) {
  const error = errors.get(field);
  if (!error) return;
  const descriptions = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== error.id);
  if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
  else field.removeAttribute('aria-describedby');
  field.removeAttribute('aria-invalid');
  error.remove();
  errors.delete(field);
}

export function showFieldError(field, message) {
  let error = errors.get(field);
  if (!error) {
    error = document.createElement('small');
    error.id = 'field-error-' + ++nextId;
    error.className = 'field-error';
    error.setAttribute('aria-live', 'polite');
    field.after(error);
    errors.set(field, error);
    field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
  }
  field.setAttribute('aria-invalid', 'true');
  error.textContent = message;
}

export function validateFields(fields) {
  let firstInvalid;
  for (const field of fields) {
    if (field.validity.valid) clearFieldError(field);
    else {
      showFieldError(field, fieldMessage(field));
      firstInvalid ||= field;
    }
  }
  firstInvalid?.focus();
  return !firstInvalid;
}

document.addEventListener('invalid', event => {
  const field = event.target;
  if (!field.form) return;
  event.preventDefault();
  showFieldError(field, fieldMessage(field));
  if (!pendingFocus) {
    pendingFocus = field;
    requestAnimationFrame(() => {
      pendingFocus?.focus();
      pendingFocus = undefined;
    });
  }
}, true);

function updateEditedField(event) {
  const field = event.target;
  if (!errors.has(field)) return;
  if (field.validity.valid) clearFieldError(field);
  else showFieldError(field, fieldMessage(field));
}

document.addEventListener('input', updateEditedField);
document.addEventListener('change', updateEditedField);
window.addEventListener('langchange', () => queueMicrotask(() => {
  for (const field of document.querySelectorAll('[aria-invalid="true"]')) {
    if (errors.has(field) && !field.validity.valid) showFieldError(field, fieldMessage(field));
  }
}));
