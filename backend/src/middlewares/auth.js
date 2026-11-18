const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { db } = require('../config/db');
const { parseCookies } = require('../helpers/cookies');
const { SESSION } = require('../helpers/session');
module.exports = (req, res, next) => {
  try {
    const p = jwt.verify(parseCookies(req.headers.cookie)[SESSION], JWT_SECRET, { algorithms: ['HS256'] });
    const u = db.users.find(x => x.id === p.uid);
    if (!u || !u.emailVerified || u.deactivatedAt || (u.tv || 0) !== (p.v || 0)) throw 0; // პაროლის შეცვლის შემდეგ ძველი სესიები არ მუშაობს
    if (u.onboardingPending && !(
      (req.method === 'GET' && req.path === '/me') ||
      (req.method === 'POST' && req.path === '/account/onboarding') ||
      (req.method === 'PUT' && req.path === '/dashboard/draft')
    )) return res.status(403).json({ error: 'Complete your profile to continue' });
    req.user = u;
    next();
  } catch { res.status(401).json({ error: 'Login required' }); }
};
