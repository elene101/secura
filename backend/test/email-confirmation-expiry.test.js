const assert = require('node:assert/strict');
const { test } = require('node:test');

test('email confirmation expires after five minutes and resending issues a fresh link', async context => {
  process.env.JWT_SECRET = 'local-email-confirmation-test-key-only';
  process.env.DB_PATH = ':memory:';
  process.env.MAIL_TRANSPORT = 'smtp';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.MAIL_FROM = 'sender@example.test';
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T12:00:00Z') });

  const { db } = require('../src/config/db');
  const { reveal } = require('../src/helpers/secrets');
  const notify = require('../src/services/notify');
  context.mock.method(notify, 'wakeQueue', () => {});
  const session = require('../src/services/email-session');
  const account = require('../src/controllers/account.controller');
  const user = { id: 'confirmation-test', email: 'test@example.test', lang: 'en' };
  db.users.push(user);
  const cookies = {};
  const response = {
    cookie(name, value, options) { cookies[name] = value; if (name === 'sg_email') assert.equal(options.maxAge, 300_000); },
    clearCookie(name) { delete cookies[name]; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
  const request = body => ({
    headers: { cookie: Object.entries(cookies).map(([name, value]) => name + '=' + value).join('; ') }, body
  });
  function readMail() {
    const job = db.notifications.at(-1);
    const message = JSON.parse(reveal(job.payload));
    assert.match(message.text, user.lang === 'ka' ? /5 წუთ/ : /5 minutes/);
    return { job, token: message.text.match(/#token=([a-f0-9]{64})/)[1] };
  }

  session.begin(response, user, { registration: true });
  const initial = readMail();
  context.mock.timers.tick(60_000);
  user.lang = 'ka';
  await session.resend(request(), response);
  const resent = readMail();
  assert.notEqual(resent.token, initial.token);
  await assert.rejects(account.verify(request({ token: initial.token }), response), /invalid or has expired/);
  context.mock.timers.tick(299_999);
  await account.verify(request({ token: resent.token }), response);
  assert.equal(response.body.signedIn, true);

  session.begin(response, user);
  const expired = readMail();
  context.mock.timers.tick(300_000);
  await assert.rejects(account.verify(request({ token: expired.token }), response), /invalid or has expired/);
  await session.status(request(), response);
  assert.deepEqual(response.body, { pending: false });

  account.sendVerification(user);
  const standalone = readMail();
  context.mock.timers.tick(300_000);
  await assert.rejects(account.verify(request({ token: standalone.token }), response), /invalid or has expired/);

  db.notifications = [expired.job, standalone.job];
  await notify.processQueue();
  assert.ok(db.notifications.every(job => job.state === 'cancelled' && !job.payload));
});
