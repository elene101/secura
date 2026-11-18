import { t } from './i18n.js';

export function verificationMessage(profile) {
  if (!profile.mailAvailable) return t('Email delivery is unavailable right now.');
  if (profile.verificationDelivery === 'accepted') return t('Check your inbox and spam folder for the confirmation email.');
  if (profile.verificationDelivery === 'failed') return t('The confirmation email could not be sent. Try again.');
  if (profile.verificationDelivery === 'retrying') return t('Email delivery failed. We’ll try again automatically.');
  if (profile.verificationDelivery === 'queued') return t('Your confirmation email is queued.');
  return t('Your email is not confirmed yet.');
}
