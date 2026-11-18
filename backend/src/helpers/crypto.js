const crypto = require('crypto'), { promisify } = require('util'), jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const scrypt = promisify(crypto.scrypt);
const N = 2 ** 15, MAXMEM = 64 * 1024 * 1024;

// ასინქრონული scrypt (სერვერს არ ბლოკავს). ფორმატი: scrypt$N$salt$hash. ძველი salt:hash ფორმატიც მუშაობს
const hash = async pw => {
  const salt = crypto.randomBytes(16), key = await scrypt(pw, salt, 64, { N, r: 8, p: 1, maxmem: MAXMEM });
  return `scrypt$${N}$${salt.toString('hex')}$${key.toString('hex')}`;
};
const verify = async (pw, stored) => {
  if (!stored || typeof pw !== 'string') return false;
  let n = 16384, salt, hex;
  if (stored.startsWith('scrypt$')) { const p = stored.split('$'); n = +p[1]; salt = Buffer.from(p[2], 'hex'); hex = p[3]; }
  else { const p = stored.split(':'); salt = p[0]; hex = p[1]; }  // ძველ ფორმატში salt ტექსტად გამოიყენებოდა
  const key = await scrypt(pw, salt, 64, { N: n, r: 8, p: 1, maxmem: MAXMEM }), exp = Buffer.from(hex, 'hex');
  return key.length === exp.length && crypto.timingSafeEqual(key, exp);
};
let dummy; // არარსებული მომხმარებლის შემთხვევაშიც იგივე დრო ვხარჯოთ, რომ ელფოსტის არსებობა არ გამოჩნდეს
const burn = async pw => { dummy ||= await hash('timing-equalizer'); await verify(pw, dummy); };

const token = u => jwt.sign({ uid: u.id, v: u.tv || 0 }, JWT_SECRET, { expiresIn: '3d', algorithm: 'HS256' });
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => { const raw = crypto.randomBytes(32).toString('hex'); return { raw, hash: sha256(raw) }; };
module.exports = { hash, verify, burn, token, sha256, randomToken };
