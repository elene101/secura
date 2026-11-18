const { isAdmin } = require('../config/env');
module.exports = (req, res, next) => isAdmin(req.user) && req.user.mfa ? next() : res.status(403).json({ error: 'Administrator access requires MFA' });
