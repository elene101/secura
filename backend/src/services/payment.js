const { db, save } = require('../config/db');
const { PAYMENT_MODE, FRONTEND_URL, PUBLIC_API_URL } = require('../config/env');
const bog = require('./bog');

function activatePlan(order) { // 30 დღით; თუ იგივე პაკეტი ჯერ აქტიურია, ვადას ვაგრძელებთ
  const u = db.users.find(x => x.id === order.userId); if (!u) return;
  const still = u.plan === order.plan && u.planUntil && new Date(u.planUntil) > new Date();
  const until = still ? new Date(u.planUntil) : new Date();
  until.setDate(until.getDate() + 30);
  u.plan = order.plan; u.planUntil = until.toISOString(); order.paid = true; save();
}
function fulfill(order) { // იდემპოტენტურია: ორჯერ გამოძახებაზე ვადა ორჯერ არ გაიზრდება
  if (order.paid) return;
  if (order.type === 'plan') activatePlan(order); else { order.paid = true; save(); }
}
async function start(order, title) {
  if (PAYMENT_MODE !== 'bog') return { mode: PAYMENT_MODE };
  const kind = order.type === 'plan' ? 'plan' : 'report';
  const { bogId, redirectUrl } = await bog.createOrder({
    orderId: order.id, amount: order.amount, title,
    callbackUrl: `${PUBLIC_API_URL}/api/payments/bog/callback`,
    successUrl: `${FRONTEND_URL}/?order=${order.id}&kind=${kind}`, failUrl: `${FRONTEND_URL}/?payment=failed`
  });
  order.bogId = bogId; save();
  return { mode: 'bog', redirectUrl };
}
async function refresh(order) {
  if (!order.paid && order.bogId && await bog.isPaid(order.bogId)) fulfill(order);
  return !!order.paid;
}
module.exports = { start, fulfill, refresh };
