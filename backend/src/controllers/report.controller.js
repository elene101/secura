const { UserError } = require('../helpers/errors');
const { db, save, id } = require('../config/db');
const { PAYMENT_MODE } = require('../config/env');
const { publicUrl } = require('../services/scan-work');
const { scan, normalizeUrl, assertPublic } = require('../services/scanner');
const { start, fulfill } = require('../services/payment');
const buildPdf = require('../services/pdf');
exports.order = async (req, res) => {
  if (PAYMENT_MODE === 'disabled') throw new UserError('Checkout is unavailable during beta', 403);
  const url = normalizeUrl(req.body.url); await assertPublic(url.hostname);
  const snapshot = await scan(url.href);
  snapshot.url = publicUrl(snapshot.url);
  const withCode = !!req.body.withCode, lang = req.body.lang === 'ka' ? 'ka' : 'en'; // PDF = 5 ₾, ready-to-paste fix code = +5 ₾
  const o = { id: id(16), url: snapshot.url, snapshot, withCode, lang, paid: false, amount: withCode ? 10 : 5, currency: 'GEL', createdAt: new Date().toISOString() };
  db.orders.push(o); save();
  res.json({ orderId: o.id, ...(await start(o, 'Secura GE – PDF report' + (withCode ? ' + fix code' : ''))) });
};
exports.demoPay = async (req, res) => {
  if (PAYMENT_MODE !== 'demo') throw new UserError('Not available');
  const o = db.orders.find(x => x.id === req.params.id && x.type !== 'plan'); if (!o) throw new UserError('Order not found');
  fulfill(o); res.json({ ok: true });
};
exports.pdf = async (req, res) => {
  const o = db.orders.find(x => x.id === req.params.id && x.type !== 'plan');
  if (!o?.paid) throw new UserError('Report is not paid');
  if (!o.snapshot) {
    const result = await scan(o.url);
    result.url = publicUrl(result.url);
    if (!o.snapshot) { o.snapshot = result; save(); }
  }
  buildPdf(o.snapshot, res, { withCode: !!o.withCode, lang: o.lang || 'en' });
};
