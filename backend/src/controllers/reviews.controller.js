const { UserError } = require('../helpers/errors');
const { db, save, id } = require('../config/db');
const USED = ['scan', 'pdf', 'code', 'monitoring', 'sms', 'email'];
const all = () => (db.reviews ||= []);
exports.list = async (req, res) => {
  const l = all(), avg = l.length ? Math.round(l.reduce((a, r) => a + r.rating, 0) / l.length * 10) / 10 : 0;
  res.json({ count: l.length, avg, reviews: l.slice().reverse().slice(0, 100).map(r => ({ id: r.id, name: r.name, rating: r.rating, used: r.used, comment: r.comment, createdAt: r.createdAt })) });
};
exports.mine = async (req, res) => res.json(all().find(r => r.userId === req.user.id) || null);
exports.save = async (req, res) => {
  if (!req.user.emailVerified) throw new UserError('Please confirm your email first. Check your inbox for the confirmation link.');
  const rating = Math.round(+req.body.rating);
  if (!(rating >= 1 && rating <= 5)) throw new UserError('Please choose a rating from 1 to 5');
  const used = (Array.isArray(req.body.used) ? req.body.used : []).filter(x => USED.includes(x));
  const comment = String(req.body.comment || '').trim().slice(0, 1000);
  const u = req.user, name = [u.firstName, u.lastName ? u.lastName[0] + '.' : ''].filter(Boolean).join(' ') || 'User';
  let r = all().find(x => x.userId === u.id);
  if (!r) { r = { id: id(), userId: u.id, createdAt: new Date().toISOString() }; all().push(r); }
  Object.assign(r, { name, rating, used, comment }); save(); res.json({ ok: true });
};
