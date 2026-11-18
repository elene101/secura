const { UserError } = require('./errors');
module.exports = fn => (req, res) => fn(req, res).catch(e => {
  if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
  console.error('Unexpected error:', e);
  res.status(500).json({ error: 'Something went wrong' });
});
