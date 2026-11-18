const CONFIRMATION_MINUTES = 5;
const CONFIRMATION_MS = CONFIRMATION_MINUTES * 60_000;

const signInExpiresAt = attempt => Math.min(attempt.expires, attempt.sent + CONFIRMATION_MS);
function verificationExpiresAt(user) {
  // Older standalone verification records stored a 24-hour expiration without an issuance time.
  const issued = user.verifyIssuedAt ?? user.verifyExp - 86_400_000;
  return Math.min(user.verifyExp, issued + CONFIRMATION_MS);
}

module.exports = { CONFIRMATION_MINUTES, CONFIRMATION_MS, signInExpiresAt, verificationExpiresAt };
