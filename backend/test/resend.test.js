const assert = require('node:assert/strict');
const { test } = require('node:test');

test('HTTPS delivery submits the message and uses a stable job reference', async context => {
  process.env.JWT_SECRET = 'local-resend-fixture-key-for-secura-only';
  process.env.MAIL_TRANSPORT = 'resend';
  process.env.RESEND_API_KEY = 'fixture';
  process.env.MAIL_FROM = 'Secura GE <sender@example.test>';
  const { deliverMail, mailConfigured } = require('../src/services/mail');
  assert.equal(mailConfigured(), true);
  const fetch = context.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'accepted' }));
  await deliverMail('recipient@example.test', 'Confirmation', 'Message', 'job-id');
  const [url, request] = fetch.mock.calls[0].arguments;
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(request.headers['Idempotency-Key'], 'secura-ge/job-id');
  assert.deepEqual(JSON.parse(request.body).to, ['recipient@example.test']);
  fetch.mock.mockImplementation(async () => Response.json({ message: 'Rejected' }, { status: 403 }));
  await assert.rejects(deliverMail('recipient@example.test', 'Confirmation', 'Message', 'job-id'), /EMAIL_API_REJECTED/);
});
