process.umask(0o077); // ახალი ფაილები (ბაზა, ფოტოები, ასლები) მხოლოდ მფლობელისთვის იკითხება
const express = require('express'), path = require('path'), fs = require('fs');
const { PORT, TRUST_PROXY } = require('./config/env');
const { headers } = require('./middlewares/security');
const { api } = require('./middlewares/rateLimit');
const csrf = require('./middlewares/csrf');
const workerOnly = process.env.MONITOR_WORKER_ONLY === '1';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY);
app.use(headers);
app.use('/api/profile/avatar', express.json({ limit: '400kb' }));
app.use(express.json({ limit: '10kb' }));
if (workerOnly) {
  const wrap = require('./helpers/wrap');
  const { receive } = require('./services/monitor-peer');
  app.post('/api/monitor-peer/check', api, wrap(receive));
} else {
  app.use('/uploads', express.static(path.join(__dirname, '../uploads'), { dotfiles: 'ignore', index: false }));
  app.use('/api', api, csrf, require('./routes'));
  const dist = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(dist)) app.use(express.static(dist, { dotfiles: 'ignore' }));
}
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // ცუდი JSON, ზედმეტად დიდი მოთხოვნა და ა.შ.
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request' });
  console.error(err); res.status(500).json({ error: 'Something went wrong' });
});
app.listen(PORT, () => {
  console.log('Secura GE API listening on port ' + PORT);
  if (!workerOnly) require('./services/monitor').startMonitor();
});
