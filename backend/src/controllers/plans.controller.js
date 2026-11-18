const { UserError } = require('../helpers/errors');
const { db, save, id } = require('../config/db');
const { PAYMENT_MODE } = require('../config/env');
const { PLANS } = require('../config/plans');
const { start, fulfill } = require('../services/payment');

exports.list = async (req, res) => res.json(Object.values(PLANS));
exports.checkout = async (req, res) => {
  if (PAYMENT_MODE === 'disabled') throw new UserError('Checkout is unavailable during beta', 403);
  if (!req.user.emailVerified) throw new UserError('Please confirm your email first. Check your inbox for the confirmation link.');
  const p = PLANS[req.body.plan]; if (!p || !p.price) throw new UserError('Unknown plan');
  const o = { id: id(), type: 'plan', plan: p.id, userId: req.user.id, paid: false, amount: p.price, currency: 'GEL', createdAt: new Date().toISOString() };
  db.orders.push(o); save();
  res.json({ orderId: o.id, ...(await start(o, `Secura GE – ${p.name} (30 days)`)) });
};
exports.demoPay = async (req, res) => {
  if (PAYMENT_MODE !== 'demo') throw new UserError('Not available');
  const o = db.orders.find(x => x.id === req.params.id && x.type === 'plan' && x.userId === req.user.id && !x.paid);
  if (!o) throw new UserError('Order not found');
  fulfill(o); res.json({ ok: true });
};
exports.cancel = async (req, res) => { // გაუქმება მაშინვე მოქმედებს, თანხა არ ბრუნდება
  delete req.user.plan; delete req.user.planUntil; save(); res.json({ ok: true });
};
