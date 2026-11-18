const { UserError } = require('../helpers/errors');
const { db, save } = require('../config/db');
const { deleteData } = require('./security.controller');
const { publicUrl } = require('../services/scan-work');
const { PLANS, activePlan } = require('../config/plans');

const audit = (req, what) => { (db.audit ||= []).push({ t: new Date().toISOString(), admin: req.user.email, action: req.route.path, target: what }); if (db.audit.length > 1000) db.audit.shift(); };
exports.overview = async (req, res) => {
  const email = id => db.users.find(u => u.id === id)?.email || '—';
  const paid = db.orders.filter(o => o.paid);
  res.json({
    stats: {
      users: db.users.length, sites: db.sites.length,
      up: db.sites.filter(s => s.status === 'up').length, down: db.sites.filter(s => s.status === 'down').length,
      paidOrders: paid.length, revenue: paid.reduce((a, o) => a + o.amount, 0),
      activePaid: db.users.filter(u => activePlan(u).price > 0).length
    },
    users: db.users.map(u => ({ id: u.id, email: u.email, company: u.company, phone: u.phone, plan: activePlan(u).id, verified: u.emailVerified === true, planUntil: u.planUntil || null, sites: db.sites.filter(s => s.userId === u.id).length })).reverse(),
    audit: db.audit.slice(-100).reverse(),
    sites: db.sites.map(s => ({ id: s.id, url: publicUrl(s.url), status: s.status, lastCheck: s.lastCheck, owner: email(s.userId) })),
    reviews: (db.reviews || []).slice().reverse().map(r => ({ id: r.id, who: r.name, email: email(r.userId), rating: r.rating, comment: r.comment, createdAt: r.createdAt })),
    orders: db.orders.slice(-50).reverse().map(o => ({ id: o.id, type: o.type || 'report', what: o.plan || (publicUrl(o.url) + (o.withCode ? ' + code' : '')), who: o.userId ? email(o.userId) : '—', amount: o.amount, paid: o.paid, createdAt: o.createdAt }))
  });
};
exports.setPlan = async (req, res) => {
  const u = db.users.find(x => x.id === req.params.id); if (!u) throw new UserError('User not found');
  const { plan, days = 30 } = req.body;
  if (plan === 'free') { delete u.plan; delete u.planUntil; }
  else {
    if (!PLANS[plan]) throw new UserError('Unknown plan');
    const until = new Date(); until.setDate(until.getDate() + Math.min(Math.max(+days || 30, 1), 3650));
    u.plan = plan; u.planUntil = until.toISOString();
  }
  audit(req, req.params.id); save(); res.json({ ok: true });
};
exports.deleteUser = async (req, res) => {
  if (req.params.id === req.user.id) throw new UserError('You cannot delete yourself');
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) throw new UserError('User not found', 404);
  audit(req, req.params.id);
  deleteData(user);
  res.json({ ok: true });
};
exports.deleteSite = async (req, res) => {
  db.sites = db.sites.filter(s => s.id !== req.params.id);
  db.shares = db.shares.filter(s => s.siteId !== req.params.id);
  db.notifications = db.notifications.filter(j => j.siteId !== req.params.id);
  audit(req, req.params.id); save(); res.json({ ok: true });
};
exports.deleteReview = async (req, res) => {
  db.reviews = (db.reviews || []).filter(r => r.id !== req.params.id); audit(req, req.params.id); save(); res.json({ ok: true });
};
