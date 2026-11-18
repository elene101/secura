const assert = require('node:assert/strict');
const { test } = require('node:test');

test('reset emails stop working exactly five minutes after issuance', async context => {
  process.env.JWT_SECRET = 'local-reset-expiry-fixture-key-for-secura-only';
  process.env.DB_PATH = ':memory:';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.MAIL_FROM = 'sender@example.test';
  const start = new Date('2026-01-01T12:00:00Z');
  context.mock.timers.enable({ apis: ['Date'], now: start });
  const { db } = require('../src/config/db');
  const { sha256 } = require('../src/helpers/crypto');
  const { reveal } = require('../src/helpers/secrets');
  const notify = require('../src/services/notify');
  context.mock.method(notify, 'wakeQueue', () => {});
  const account = require('../src/controllers/account.controller');
  const user = { id: 'reset-test', email: 'test@example.test', firstName: 'Tester', lang: 'en', resetHash: sha256('previous'), resetExp: +start + 3_600_000 };
  db.users.push(user);
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  const reset = token => account.reset({ body: { token, password: 'Test! password 54283' } }, response);

  await assert.rejects(reset('previous'), /invalid or has expired/);
  async function requestReset() {
    await account.forgot({ body: { email: user.email } }, response);
    assert.equal(response.code, 202);
    assert.equal(user.resetExpiresAt, Date.now() + 300_000);
    const job = db.notifications.at(-1);
    const email = JSON.parse(reveal(job.payload));
    assert.match(email.text, user.lang === 'ka' ? /5 წუთი/ : /5 minutes/);
    return { job, token: email.text.match(/#token=([a-f0-9]+)/)[1] };
  }

  const first = await requestReset();
  context.mock.timers.tick(299_999);
  await reset(first.token);
  assert.deepEqual(response.body, { ok: true });
  await assert.rejects(reset(first.token), /invalid or has expired/);

  user.lang = 'ka';
  const second = await requestReset();
  context.mock.timers.tick(300_000);
  await assert.rejects(reset(second.token), /invalid or has expired/);
  // Remove the unrelated password-change email so no SMTP connection is needed in this test.
  db.notifications = [second.job];
  await notify.processQueue();
  assert.equal(second.job.state, 'cancelled');
  assert.equal(second.job.payload, undefined);
});
