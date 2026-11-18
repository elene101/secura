const { PORT = 3000, JWT_SECRET, SMSOFFICE_KEY, SMS_SENDER = 'SecuraGE', PAYMENT_MODE = 'demo', ADMIN_EMAILS = '',
  BOG_CLIENT_ID, BOG_CLIENT_SECRET, PUBLIC_API_URL = '', FRONTEND_URL = 'http://localhost:5173',
  GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_MESSAGING_SERVICE_SID, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM,
  NODE_ENV, EXTRA_ORIGINS: XO = '', TRUST_PROXY: TP, ALLOW_DEMO_PAYMENTS, ALLOW_PRIVATE_TARGETS: APT } = process.env;
const IS_PROD = NODE_ENV === 'production';

if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32');
if (!['demo', 'bog', 'disabled'].includes(PAYMENT_MODE)) throw new Error('Unknown PAYMENT_MODE');
if (PAYMENT_MODE === 'bog' && !PUBLIC_API_URL.startsWith('https://'))
  throw new Error('PAYMENT_MODE=bog requires PUBLIC_API_URL to be an https:// address (for the bank callback)');
if (IS_PROD && PAYMENT_MODE === 'demo' && ALLOW_DEMO_PAYMENTS !== '1')
  throw new Error('Demo payments are disabled in production (anyone could "buy" for free). Set PAYMENT_MODE=disabled for a beta without checkout.');
if (IS_PROD && !FRONTEND_URL.startsWith('https://')) throw new Error('FRONTEND_URL must be an https:// address in production');

const admins = ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
module.exports = {
  PORT, JWT_SECRET, SMSOFFICE_KEY, SMS_SENDER, PAYMENT_MODE, BOG_CLIENT_ID, BOG_CLIENT_SECRET, PUBLIC_API_URL, FRONTEND_URL,
  GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_MESSAGING_SERVICE_SID, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM,
  API_BASE: PUBLIC_API_URL || `http://localhost:${PORT}`, IS_PROD, EXTRA_ORIGINS: XO.split(',').map(s => s.trim()).filter(Boolean),
  TRUST_PROXY: TP ? (Number.isNaN(+TP) ? TP : +TP) : false,        // მხოლოდ მაშინ ჩართე, როცა სერვერი proxy-ს უკანაა
  ALLOW_PRIVATE_TARGETS: !IS_PROD && APT === '1',                    // მხოლოდ ტესტებისთვის, production-ში არასდროს მუშაობს
  // ადმინი მხოლოდ დადასტურებული ელფოსტით, რომ სხვამ შენი ელფოსტით წინასწარ ანგარიში ვერ გახსნას
  isAdmin: u => u.emailVerified === true && admins.includes(u.email)
};
