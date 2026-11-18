import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { t } from './i18n.js';

export function requirePasskeySupport() {
  if (!window.isSecureContext || !browserSupportsWebAuthn())
    throw new Error(t('Passkeys require a supported browser on HTTPS or localhost.'));
}

function operationError(error) {
  return new Error(t(error.name === 'NotAllowedError' || error.name === 'AbortError'
    ? 'Passkey confirmation was cancelled or timed out.'
    : 'The browser could not use a passkey. Check your device unlock settings.'));
}

export async function createPasskey(optionsJSON) {
  try {
    return await startRegistration({ optionsJSON });
  } catch (error) {
    throw operationError(error);
  }
}

export async function usePasskey(optionsJSON) {
  try {
    return await startAuthentication({ optionsJSON });
  } catch (error) {
    throw operationError(error);
  }
}
