const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const { FRONTEND_URL } = require('../config/env');
const { save } = require('../config/db');

const { origin, hostname: rpID } = new URL(FRONTEND_URL);
const lifetime = 3 * 60 * 1000;
const versionOf = user => user.tv || 0;
const flow = (options, user) => ({ challenge: options.challenge, expires: Date.now() + lifetime, version: versionOf(user) });
const current = (state, user) => state?.expires > Date.now() && state.version === versionOf(user);

async function registrationOptions(user) {
  return generateRegistrationOptions({
    rpName: 'Secura GE', rpID, userName: user.email, userID: Buffer.from(user.id),
    timeout: lifetime, attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }
  });
}

function beginRegistration(user, options) {
  user.passkeySetup = flow(options, user);
  save();
}

async function register(user, response) {
  const state = user.passkeySetup;
  if (!current(state, user)) return null;
  delete user.passkeySetup;
  save();
  try {
    const result = await verifyRegistrationResponse({
      response, expectedChallenge: state.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true
    });
    if (!result.verified || !current(state, user) || user.passkeySetup || user.mfa?.credential) return null;
    const { id, publicKey, counter, transports } = result.registrationInfo.credential;
    return { id, publicKey: Buffer.from(publicKey).toString('base64url'), counter, transports };
  } catch {
    return null;
  }
}

async function beginAssertion(user, purpose, login) {
  const credential = user.mfa?.credential;
  const version = versionOf(user);
  if (!credential) return null;
  const options = await generateAuthenticationOptions({
    rpID, timeout: lifetime, userVerification: 'required',
    allowCredentials: [{ id: credential.id, transports: credential.transports }]
  });
  if (user.mfa?.credential !== credential || versionOf(user) !== version || (login && user.mfaChallenge !== login)) return null;
  const state = { ...flow(options, user), purpose };
  if (login) login.passkey = state;
  else user.passkeyAction = state;
  save();
  return options;
}

async function verifyAssertion(user, response, purpose, login) {
  const credential = user.mfa?.credential;
  const state = login ? login.passkey : user.passkeyAction;
  if (!credential || !current(state, user) || state.purpose !== purpose || response?.id !== credential.id) return false;
  if (login) delete login.passkey;
  else delete user.passkeyAction;
  save();
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response, expectedChallenge: state.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { ...credential, publicKey: Buffer.from(credential.publicKey, 'base64url') }
    });
    if (!verified || !current(state, user) || user.mfa?.credential !== credential || (login && user.mfaChallenge !== login)) return false;
    const counter = authenticationInfo.newCounter;
    if ((counter || credential.counter) && counter <= credential.counter) return false;
    credential.counter = counter;
    save();
    return true;
  } catch {
    return false;
  }
}

module.exports = { registrationOptions, beginRegistration, register, beginAssertion, verifyAssertion };
