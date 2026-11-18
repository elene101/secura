const crypto = require('node:crypto');
const { JWT_SECRET } = require('../config/env');
const key = crypto.hkdfSync('sha256', process.env.DATA_SECRET || JWT_SECRET, Buffer.alloc(0), 'secura-encryption-v1', 32);

function protect(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map(b => b.toString('base64url')).join('.');
}

function reveal(value) {
  const [iv, tag, bytes] = value.split('.').map(s => Buffer.from(s, 'base64url'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(bytes), cipher.final()]).toString('utf8');
}
module.exports = { protect, reveal };
