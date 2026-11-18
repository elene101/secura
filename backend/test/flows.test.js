const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { TOTP, Secret } = require('otpauth');

const { startSmtp } = require('../test-support/smtp');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(job) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await job().catch(() => null);
    if (result) return result;
    await delay(50);
  }
  throw new Error('Timed out waiting for the local test condition');
}
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

test('monitor incidents, notification queue, role boundaries, verified accounts and MFA', async context => {
  const temp = await mkdtemp(join(tmpdir(), 'secura-test-'));
  context.after(() => rm(temp, { recursive: true, force: true }));
  let monitoredStatus = 404;
  const target = createServer((req, res) => {
    res.writeHead(monitoredStatus, { 'Content-Type': 'text/plain' });
    res.end('test endpoint');
  });
  const targetPort = await listen(target);
  context.after(() => target.close());
  const portServer = createServer();
  const appPort = await listen(portServer);
  await new Promise(resolve => portServer.close(resolve));
  const smtp = await startSmtp();
  context.after(smtp.close);
  let terminal = '';
  const mockPath = join(temp, 'oauth-provider.cjs');
  await writeFile(mockPath, `
    const original = fetch;
    require('node:dns').promises.Resolver.prototype.resolveTxt = async function () {
      return [[require('node:fs').readFileSync('fixture-domain.txt', 'utf8')]];
    };
    const responses = new Map([
      ['https://oauth2.googleapis.com/token', { access_token: 'google-test' }],
      ['https://openidconnect.googleapis.com/v1/userinfo', { sub: '42', email_verified: true, email: 'google@example.test', given_name: 'Google', family_name: 'Tester' }],
      ['https://github.com/login/oauth/access_token', { access_token: 'github-test' }],
      ['https://api.github.com/user', { id: 43, name: 'GitHub Tester' }],
      ['https://api.github.com/user/emails', [{ primary: true, verified: true, email: 'github@example.test' }]]
    ]);
    global.fetch = (url, options) => {
      if (url === 'https://api.telegram.org/botlocal-telegram-fixture/sendMessage') {
        require('node:fs').writeFileSync('fixture-telegram.json', options.body);
        return Promise.resolve(Response.json({ ok: true }));
      }
      if (url === 'https://smsoffice.ge/api/v2/send/') {
        const form = options.body;
        if (options.method !== 'POST' || form.get('key') !== 'local-sms-fixture' || form.get('sender') !== 'Fixture')
          return Promise.resolve(Response.json({ Success: false, ErrorCode: 80 }));
        require('node:fs').appendFileSync('fixture-sms.txt', form.get('content') + '\\n');
        return Promise.resolve(Response.json({ Success: true, Output: 'fixture-message' }));
      }
      return responses.has(url) ? Promise.resolve(Response.json(responses.get(url))) : original(url, options);
    };
  `);
  const env = {
    PATH: process.env.PATH, PORT: String(appPort), JWT_SECRET: 'local-test-fixture-key-for-secura-only',
    FRONTEND_URL: 'http://127.0.0.1:' + appPort, ALLOW_PRIVATE_TARGETS: '1',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), MAIL_FROM: 'sender@example.test',
    GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture', GITHUB_CLIENT_ID: 'fixture', GITHUB_CLIENT_SECRET: 'fixture',
    SMSOFFICE_KEY: 'local-sms-fixture', SMS_SENDER: 'Fixture', TELEGRAM_BOT_TOKEN: 'local-telegram-fixture',
    ADMIN_EMAILS: 'owner@example.test', DB_PATH: join(temp, 'primary.sqlite')
  };
  const app = spawn(process.execPath, ['--require', mockPath, join(__dirname, '../src/server.js')], { cwd: temp, env });
  const stopped = once(app, 'exit');
  context.after(async () => { app.kill(); await stopped; });
  app.stdout.on('data', bytes => { terminal += bytes; });
  app.stderr.resume();
  const base = 'http://127.0.0.1:' + appPort + '/api';
  await until(async () => (await fetch(base + '/health')).status === 200);

  function session() {
    const cookies = new Map();
    return async (path, method = 'GET', data) => {
      const response = await fetch(base + path, {
        method, redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          Cookie: Array.from(cookies, ([k, v]) => k + '=' + v).join('; '),
          'X-CSRF-Token': cookies.get('sg_csrf') || ''
        },
        body: data === undefined ? undefined : JSON.stringify(data)
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [key, value] = cookie.split(';')[0].split('=');
        if (value) cookies.set(key, value);
        else cookies.delete(key);
      }
      const value = await response.json().catch(() => null);
      return { status: response.status, value, location: response.headers.get('location') };
    };
  }
  const password = 'Strong! fixture password 01';
  const messageToken = (recipient, expression, start = 0) => until(async () =>
    smtp.messages.slice(start).filter(mail => mail.recipient === recipient)
      .map(mail => mail.text.match(expression)?.[1]).find(Boolean)
  );
  const signInToken = (email, start) => messageToken(email, /verify\.html#token=([a-f0-9]+)/, start);
  async function confirmLogin(client, email, start) {
    assert.equal((await client('/me')).status, 401);
    const token = await signInToken(email, start);
    const result = await client('/verify-email', 'POST', { token });
    assert.equal(result.status, 200);
    assert.equal(result.value.signedIn, true);
    assert.equal(terminal.includes(token), false);
  }
  async function register(client, email, firstName, verifyNow = true) {
    const start = smtp.messages.length;
    const work = verifyNow
      ? { companyType: 'Startup', company: 'Secura Test', companySize: '2-10', role: 'Owner / founder' }
      : { companyType: 'Freelancer', company: 'Independent Studio', companySize: 'Just me', role: 'IT / security' };
    const response = await client('/register', 'POST', { email, firstName, lastName: 'Tester', password, ...work });
    assert.equal(response.status, 202);
    assert.equal(response.value.emailConfirmation, true);
    assert.equal((await client('/me')).status, 401);
    const token = await signInToken(email, start);
    if (verifyNow) {
      await confirmLogin(client, email, start);
      const profile = (await client('/me')).value;
      assert.equal(profile.onboardingPending, false);
      assert.equal(profile.emailVerified, true);
      for (const [key, value] of Object.entries(work)) assert.equal(profile[key], value);
    }
    return token;
  }

  const owner = session(), viewer = session(), unauthenticated = session();
  for (const weak of ['TooShort!', 'notupper!!222', 'MissingSymbol32']) {
    const invalid = await owner('/register', 'POST', { email: 'owner@example.test', firstName: 'Owner', password: weak });
    assert.equal(invalid.status, 400);
    assert.match(invalid.value.error, /uppercase letter and a special character/);
  }
  await register(owner, 'owner@example.test', 'Owner');
  const viewerVerification = await register(viewer, 'viewer@example.test', 'Viewer', false);

  for (const provider of ['google', 'github']) {
    const client = session();
    async function login() {
      const start = smtp.messages.length;
      const authorization = await client('/auth/' + provider + '/url');
      const state = new URL(authorization.value.url).searchParams.get('state');
      const callback = await client('/auth/' + provider + '/callback?code=fixture&state=' + state);
      assert.equal(callback.status, 302);
      assert.equal(new URL(callback.location).search, '?confirm');
      await confirmLogin(client, provider + '@example.test', start);
    }
    await login();
    assert.equal((await client('/me')).value.onboardingPending, true);
    assert.equal((await client('/sites')).status, 403);
    const profile = { firstName: 'Updated', lastName: 'Tester', companyType: 'Startup', role: 'Developer' };
    assert.equal((await client('/account/onboarding', 'POST', profile)).status, 400);
    assert.equal((await client('/account/onboarding', 'POST', { ...profile, company: 'Secura', companySize: '2-10' })).status, 200);
    assert.equal((await client('/me')).value.company, 'Secura');
    assert.equal((await client('/profile', 'PUT', { company: 'Renamed' })).status, 200);
    await client('/logout', 'POST');
    await login();
    assert.equal((await client('/me')).value.onboardingPending, false);
    assert.equal((await client('/me')).value.company, 'Renamed');
  }
  const url = 'http://127.0.0.1:' + targetPort + '/page?private=example';
  const add = await owner('/sites', 'POST', { url });
  assert.equal(add.status, 201, JSON.stringify(add.value));
  const monitor = '/sites/' + add.value.id;
  const outage = await until(async () => (await owner(monitor + '/stats')).value.incidents?.[0]);
  assert.equal(outage.reason, 'HTTP 404');
  assert.equal((await owner(monitor, 'PUT', { interval: 5 })).status, 400);
  assert.equal((await owner(monitor + '/verification', 'GET')).status, 200);
  const queue = (await owner('/notifications')).value;
  assert.equal(queue[0].type, 'down');
  assert.equal(queue[0].state, 'queued');
  assert.equal((await owner('/notifications/test', 'POST', { channel: 'email' })).status, 202);
  const verification = (await owner(monitor + '/verification')).value.verification;
  await writeFile(join(temp, 'fixture-domain.txt'), verification.value);
  assert.equal((await owner(monitor + '/verification', 'POST')).status, 200);
  assert.equal((await owner(monitor, 'PUT', { telegram: '-1001234567' })).status, 200);
  assert.equal((await owner('/notifications/test', 'POST', { channel: 'slack', siteId: add.value.id })).status, 400);
  assert.equal((await owner('/notifications/test', 'POST', { channel: 'telegram', siteId: add.value.id })).status, 202);
  const telegramJob = await until(async () => (await owner('/notifications')).value.find(job => job.channel === 'telegram' && job.state === 'accepted'));
  assert.equal(telegramJob.type, 'test');
  assert.equal(JSON.parse(await readFile(join(temp, 'fixture-telegram.json'), 'utf8')).chat_id, '-1001234567');


  monitoredStatus = 200;
  assert.equal((await owner(monitor + '/check', 'POST')).value.status, 'up');
  const history = (await owner(monitor + '/stats?days=30')).value;
  assert.equal(history.checks, 2);
  assert.ok(history.incidents[0].end);
  assert.equal((await owner(monitor, 'PUT', { paused: true })).value.status, 'paused');
  assert.equal((await owner(monitor + '/check', 'POST')).status, 409);
  assert.equal((await viewer(monitor + '/stats')).status, 401);

  const smsReply = async () => (await readFile(join(temp, 'fixture-sms.txt'), 'utf8')).trim();
  assert.equal((await owner('/notifications/test', 'POST', { channel: 'sms' })).status, 400);
  const phone = '599123456';
  assert.equal((await owner('/profile', 'PUT', { phone })).status, 200);
  assert.equal((await owner('/account/phone/send', 'POST', { phone })).status, 200);
  const codeOnPhone = (await smsReply()).match(/Secura GE: (\d{6})/)?.[1];
  assert.ok(codeOnPhone);
  assert.equal((await owner('/account/phone/verify', 'POST', { code: codeOnPhone })).status, 200);
  assert.equal((await owner('/notifications/test', 'POST', { channel: 'sms' })).status, 202);
  const smsJob = await until(async () => (await owner('/notifications')).value.find(job => job.channel === 'sms' && job.state === 'accepted'));
  assert.equal(smsJob.type, 'test');
  assert.match(await smsReply(), /Secura GE test notification/);


  const team = (await owner('/workspaces', 'POST', { name: 'Test workspace' })).value;
  const invitePath = '/workspaces/' + team.id + '/invite';
  const email = 'viewer@example.test';
  const invite = (await owner(invitePath, 'POST', { email })).value;
  const secondInvite = (await owner(invitePath, 'POST', { email })).value;
  const inviteToken = invite.path.split('=')[1], secondToken = secondInvite.path.split('=')[1];
  const preview = (client, token) => client('/workspaces/invitations/preview', 'POST', { token });
  const respond = (client, token, decision) => client('/workspaces/accept', 'POST', { token, decision });
  assert.equal((await preview(owner, inviteToken)).value.sender, true);
  assert.equal((await respond(owner, inviteToken, 'accept')).status, 403);
  assert.equal((await viewer('/workspaces/invitations')).status, 401);
  assert.equal((await preview(viewer, inviteToken)).status, 401);
  assert.equal((await respond(viewer, inviteToken, 'decline')).status, 401);
  assert.equal((await viewer('/email-session', 'POST')).value.pending, true);
  const crossDevice = await unauthenticated('/verify-email', 'POST', { token: viewerVerification });
  assert.equal(crossDevice.value.signedIn, false);
  assert.equal((await unauthenticated('/me')).status, 401);
  assert.equal((await viewer('/me')).status, 401);
  assert.equal((await viewer('/email-session', 'POST')).value.signedIn, true);
  assert.equal((await unauthenticated('/verify-email', 'POST', { token: viewerVerification })).status, 400);
  assert.equal((await viewer('/workspaces/invitations')).value.length, 1);
  const intl = '+1 202 555 0142';
  assert.equal((await viewer('/profile', 'PUT', { phone: intl })).status, 200);
  const missingSmsProvider = await viewer('/account/phone/send', 'POST', { phone: intl });
  assert.equal(missingSmsProvider.status, 503);
  assert.match(missingSmsProvider.value.error, /no provider is configured/);
  assert.equal((await preview(viewer, inviteToken)).value.status, 'pending');
  assert.equal((await owner('/workspaces')).value[0].members.length, 0);
  assert.equal((await respond(viewer, inviteToken, 'decline')).value.status, 'declined');
  assert.equal((await preview(owner, secondToken)).value.status, 'declined');
  assert.equal((await respond(viewer, secondToken, 'accept')).value.status, 'declined');
  assert.equal((await viewer('/workspaces/invitations')).value.length, 0);
  assert.equal((await viewer('/me')).value.pending, null);

  const newInvite = (await owner(invitePath, 'POST', { email })).value.path.split('=')[1];
  const [incoming] = (await viewer('/workspaces/invitations')).value;
  assert.equal((await viewer('/workspaces/accept', 'POST', { reference: incoming.reference, decision: 'accept' })).value.status, 'accepted');
  assert.equal((await preview(owner, newInvite)).value.status, 'accepted');
  assert.equal((await respond(viewer, newInvite, 'accept')).value.status, 'accepted');
  assert.equal((await owner('/workspaces')).value[0].members.length, 1);
  assert.equal((await owner(monitor, 'PUT', { workspaceId: team.id })).status, 200);
  const visible = (await viewer('/sites')).value[0];
  assert.equal(visible.owner, false);
  assert.equal(visible.canCheck, false);
  assert.equal(visible.url.includes('?'), false);
  assert.equal((await viewer(monitor + '/check', 'POST')).status, 404);
  assert.equal((await viewer(monitor, 'PUT', { paused: false })).status, 404);
  const memberId = (await owner('/workspaces')).value[0].members[0].id;
  const memberPath = '/workspaces/' + team.id + '/members/' + memberId;
  assert.equal((await viewer(memberPath, 'PATCH', { role: 'operator' })).status, 404);
  assert.equal((await owner(memberPath, 'PATCH', { role: 'operator' })).value.members[0].role, 'operator');
  assert.equal((await viewer('/sites')).value[0].canCheck, true);
  assert.equal((await viewer(monitor + '/check', 'POST')).status, 409);
  assert.equal((await viewer(monitor, 'PUT', { paused: false })).status, 404);
  assert.equal((await owner(memberPath, 'PATCH', { role: 'viewer' })).status, 200);
  assert.equal((await viewer(monitor + '/check', 'POST')).status, 404);
  const workspaceState = '/workspaces/' + team.id + '/state';
  assert.equal((await viewer(workspaceState, 'PATCH', { active: false })).status, 404);
  assert.equal((await owner(workspaceState, 'PATCH', { active: false })).value.deactivated, true);
  assert.equal((await owner('/me')).status, 200);
  assert.equal((await owner('/sites')).value[0].status, 'inactive');
  assert.equal((await viewer('/sites')).value.length, 0);
  assert.equal((await owner(monitor + '/check', 'POST')).status, 409);
  assert.equal((await owner(workspaceState, 'PATCH', { active: true })).value.deactivated, false);
  assert.equal((await owner('/sites')).value[0].status, 'paused');
  assert.equal((await viewer('/sites')).value.length, 1);
  assert.equal((await owner(memberPath, 'DELETE')).status, 200);
  assert.equal((await preview(viewer, newInvite)).status, 404);
  const share = (await owner(monitor + '/share', 'POST')).value;
  const shared = (await unauthenticated('/share', 'POST', { token: share.path.split('=')[1] })).value;
  assert.equal(shared.url.includes('?'), false);
  assert.equal(shared.checks, 2);

  assert.equal((await owner('/admin/overview')).status, 403);
  const setup = (await owner('/account/mfa/setup', 'POST', { password })).value;
  const code = new TOTP({ secret: Secret.fromBase32(setup.secret) }).generate();
  const mfa = await owner('/account/mfa/enable', 'POST', { code });
  assert.equal(mfa.status, 200);
  assert.equal((await owner('/admin/overview')).status, 200);
  assert.equal((await owner('/logout', 'POST')).status, 200);
  assert.equal((await owner('/login', 'POST', { email: 'owner@example.test', password })).value.mfa, true);
  assert.equal((await owner('/admin/overview')).status, 401);
  const ownerEmailStart = smtp.messages.length;
  assert.equal((await owner('/account/mfa/challenge', 'POST', { code: mfa.value.recovery[0] })).status, 202);
  assert.equal((await owner('/admin/overview')).status, 401);
  await confirmLogin(owner, 'owner@example.test', ownerEmailStart);
  assert.equal((await owner('/admin/overview')).status, 200);

  const weakChange = await viewer('/password', 'POST', { current: password, next: 'NoSymbolWritten' });
  assert.equal(weakChange.status, 400);
  const changeStart = smtp.messages.length;
  const changedPassword = 'Changed! fixture 01234';
  assert.equal((await viewer('/password', 'POST', { current: password, next: changedPassword })).status, 200);
  await until(async () => smtp.messages.slice(changeStart).some(mail => mail.recipient === 'viewer@example.test' && mail.text.includes('was just changed')));
  const recovery = await unauthenticated('/forgot', 'POST', { email: 'viewer@example.test' });
  const absent = await unauthenticated('/forgot', 'POST', { email: 'unknown@example.test' });
  assert.deepEqual(recovery, absent);
  const token = await messageToken('viewer@example.test', /reset\.html#token=([a-f0-9]+)/, changeStart);
  assert.equal(terminal.includes(token), false);
  assert.equal((await unauthenticated('/reset', 'POST', { token, password: 'no uppercase!!' })).status, 400);
  assert.equal((await unauthenticated('/reset', 'POST', { token, password })).status, 200);
  assert.equal((await unauthenticated('/reset', 'POST', { token, password })).status, 400);
  const viewerEmailStart = smtp.messages.length;
  assert.equal((await viewer('/login', 'POST', { email: 'viewer@example.test', password })).status, 202);
  await confirmLogin(viewer, 'viewer@example.test', viewerEmailStart);
  assert.equal((await viewer('/account/deactivate', 'POST', { password: 'wrong' })).status, 403);
  assert.equal((await viewer('/account/deactivate', 'POST', { password })).status, 200);
  assert.equal((await viewer('/me')).status, 401);
  const reactivateStart = smtp.messages.length;
  assert.equal((await viewer('/login', 'POST', { email: 'viewer@example.test', password })).status, 202);
  assert.equal((await viewer('/email-session', 'POST')).value.reactivation, true);
  await confirmLogin(viewer, 'viewer@example.test', reactivateStart);

  const exported = (await viewer('/account/export')).value;
  assert.equal(exported.profile.email, 'viewer@example.test');
  assert.equal(exported.profile.pass, undefined);
  assert.equal((await viewer('/account', 'DELETE', { email: 'viewer@example.test', password })).status, 200);
  assert.equal((await viewer('/me')).status, 401);
});
