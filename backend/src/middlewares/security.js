const crypto = require('crypto');
const { IS_PROD, PUBLIC_API_URL, TRUST_PROXY } = require('../config/env');
// ეს ტექსტი უნდა ემთხვეოდეს HTML-ებში ჩაწერილ თემის სკრიპტს (CSP მის ჰეშს ამოწმებს)
const THEME_JS = "try{document.documentElement.dataset.theme=localStorage.getItem('sg_theme')||'dark'}catch(e){}";
const themeHash = crypto.createHash('sha256').update(THEME_JS).digest('base64');
const CSP = ["default-src 'self'", `script-src 'self' 'sha256-${themeHash}'`, "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: https:", "connect-src 'self'", "object-src 'none'",
  "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');

exports.THEME_JS = THEME_JS;
exports.headers = (req, res, next) => {
  if (IS_PROD && TRUST_PROXY && PUBLIC_API_URL && req.protocol === 'http') return res.redirect(301, PUBLIC_API_URL + req.originalUrl);
  res.set({
    'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin'
  });
  if (IS_PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  next();
};
