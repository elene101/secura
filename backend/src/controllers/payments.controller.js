const { UserError } = require('../helpers/errors');
const { db } = require('../config/db');
const { refresh } = require('../services/payment');
exports.bogCallback = async (req, res) => { // ბანკი ამ მისამართს იძახებს გადახდის შემდეგ
  const b = req.body?.body || req.body || {};
  const o = db.orders.find(x => x.id === b.external_order_id || (b.order_id && x.bogId === b.order_id));
  if (o) await refresh(o);
  res.sendStatus(200);
};
exports.status = async (req, res) => { // ფრონტი ბანკიდან დაბრუნებისას ამას ეკითხება
  const o = db.orders.find(x => x.id === req.params.id); if (!o) throw new UserError('Order not found');
  res.json({ paid: await refresh(o) });
};
