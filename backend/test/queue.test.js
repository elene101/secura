const assert = require('node:assert/strict');
const { mkdtemp, copyFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

test('notification retry and recovery from an isolated backup', async context => {
  const folder = await mkdtemp(join(tmpdir(), 'secura-backup-'));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const { startSmtp } = require('../test-support/smtp');
  const smtp = await startSmtp({ rejectFirst: true });
  context.after(smtp.close);

  process.env.DB_PATH = join(folder, 'original.sqlite');
  process.env.JWT_SECRET = 'local-test-fixture-key-for-secura-only';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtp.port);
  process.env.MAIL_FROM = 'from@example.test';
  const { db, save, backupTo } = require('../src/config/db');
  const { enqueue, processQueue } = require('../src/services/notify');
  const user = { id: 'sample', email: 'test@example.test', emailVerified: true };
  db.users.push(user);
  const message = { en: { subject: 'Test', text: 'Test' }, ka: { subject: 'Test', text: 'Test' } };
  const [job] = enqueue(user, { message, type: 'test', channels: ['email'] });
  save();
  await processQueue();
  assert.equal(job.state, 'queued');
  assert.equal(job.attempts, 1);
  assert.ok(job.due > Date.now());
  job.due = Date.now();
  save();
  await processQueue();
  assert.equal(job.state, 'accepted');
  assert.equal(smtp.messages.length, 2);

  const archive = join(folder, 'archive.sqlite');
  backupTo(archive);
  const restore = join(folder, 'restored.sqlite');
  await copyFile(archive, restore);
  const restored = new DatabaseSync(restore, { readOnly: true });
  try {
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    const saved = JSON.parse(restored.prepare("SELECT json FROM docs WHERE kind='notifications'").get().json);
    assert.equal(saved.state, 'accepted');
    assert.equal(saved.attempts, 2);
    assert.equal(saved.message, undefined);
  } finally { restored.close(); }
});
