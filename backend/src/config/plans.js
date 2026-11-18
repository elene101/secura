// Plansს ფასები და ლიმიტები იცვლება მხოლოდ აქ
const PLANS = {
  free:     { id: 'free',     name: 'Free',    price: 0,  sites: 1,  sms: false },
  start:    { id: 'start',    name: 'Start',    price: 15,  sites: 3,  sms: true },
  business: { id: 'business', name: 'Business', price: 45, sites: 10, sms: true },
};
const activePlan = u => (u.plan && u.planUntil && new Date(u.planUntil) > new Date() && PLANS[u.plan]) || PLANS.free;
module.exports = { PLANS, activePlan };
