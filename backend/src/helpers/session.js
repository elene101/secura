// სესია httpOnly cookie-შია: JavaScript-ს (მათ შორის შეჭრილ სკრიპტს) მისი წაკითხვა არ შეუძლია. CSRF ტოკენი ცალკე, წასაკითხ cookie-შია
const crypto = require('crypto');
const { IS_PROD } = require('../config/env');
const { token } = require('./crypto');
const SESSION = IS_PROD ? '__Host-sg_session' : 'sg_session', CSRF = IS_PROD ? '__Host-sg_csrf' : 'sg_csrf'; // __Host- პრეფიქსი ქვედომენიდან cookie-ს ჩანაცვლებას უშლის
const base = { sameSite: 'lax', secure: IS_PROD, path: '/' }, MAX_AGE = 3 * 864e5;
const startSession = (res, u) => {
  res.cookie(SESSION, token(u), { ...base, httpOnly: true, maxAge: MAX_AGE });
  res.cookie(CSRF, crypto.randomBytes(24).toString('hex'), { ...base, httpOnly: false, maxAge: MAX_AGE });
};
const endSession = res => { res.clearCookie(SESSION, base); res.clearCookie(CSRF, base); };
module.exports = { SESSION, CSRF, startSession, endSession };
