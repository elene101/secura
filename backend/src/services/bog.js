// Bank of Georgia – Payments API v1 (OAuth2 client credentials)
const { BOG_CLIENT_ID, BOG_CLIENT_SECRET } = require('../config/env');
const API = 'https://api.bog.ge/payments/v1';
const AUTH = 'https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token';
let cache = { token: null, exp: 0 };

async function token() {
  if (cache.token && Date.now() < cache.exp) return cache.token;
  if (!BOG_CLIENT_ID || !BOG_CLIENT_SECRET) throw new Error('BOG_CLIENT_ID / BOG_CLIENT_SECRET are not set in .env');
  const r = await fetch(AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${BOG_CLIENT_ID}:${BOG_CLIENT_SECRET}`).toString('base64') },
    body: 'grant_type=client_credentials'
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('BOG authorization failed');
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return cache.token;
}
async function call(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json', 'Accept-Language': 'ka' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('BOG: ' + (j.message || r.status));
  return j;
}
exports.createOrder = async ({ orderId, amount, title, callbackUrl, successUrl, failUrl }) => {
  const j = await call('/ecommerce/orders', { method: 'POST', body: JSON.stringify({
    callback_url: callbackUrl, external_order_id: orderId,
    purchase_units: { currency: 'GEL', total_amount: amount, basket: [{ product_id: orderId, description: title, quantity: 1, unit_price: amount }] },
    redirect_urls: { success: successUrl, fail: failUrl }
  }) });
  if (!j._links?.redirect?.href) throw new Error('BOG did not return a payment URL');
  return { bogId: j.id, redirectUrl: j._links.redirect.href };
};
// გადახდას ვამოწმებთ ბანკის API-დან და არა callback-ის სხეულიდან, რომ გაყალბება შეუძლებელი იყოს
exports.isPaid = async bogId => (await call('/receipt/' + bogId)).order_status?.key === 'completed';
