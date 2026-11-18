const { PAYMENT_MODE } = require('../config/env');
const { system } = require('../services/monitor');

exports.health = async (req, res) => {
  const state = system();
  const healthy = !!state?.heartbeat && Date.now() - state.heartbeat < 3 * 60000 && !state.pending;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'operational' : 'degraded',
    lastSchedulerHeartbeat: state?.heartbeat || null,
    lastSweep: state?.completed || null
  });
};

exports.support = async (req, res) => {
  const email = process.env.SUPPORT_EMAIL || '';
  res.json({ email: /^[a-z0-9._+\-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) ? email : null });
};

exports.features = async (req, res) => {
  res.json({ checkout: PAYMENT_MODE !== 'disabled' });
};
