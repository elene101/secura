const assert = require('node:assert/strict');
const { test } = require('node:test');

test('reputation works without a key and reports DNS-only scope', async context => {
  process.env.JWT_SECRET = 'fixture-key-used-for-reputation-tests-only';
  delete process.env.GOOGLE_WEB_RISK_KEY;
  const { lookup } = require('../src/controllers/reputation.controller');
  const dns = context.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url.hostname, 'security.cloudflare-dns.com');
    assert.equal(url.searchParams.get('name'), 'example.com');
    assert.equal(url.searchParams.has('uri'), false);
    return Response.json({ Status: 0, Answer: [{ type: 1, data: '93.184.215.14' }] });
  });
  async function check(expectedStatus, expectedScope = 'domain') {
    let result;
    await lookup({ body: { url: 'https://example.com/some-path?private=yes#fragment' } }, { json(value) { result = value; } });
    assert.equal(result.status, expectedStatus);
    assert.equal(result.scope, expectedScope);
    assert.ok(result.checkedAt);
    return result;
  }

  await check('no_match');
  dns.mock.mockImplementation(async () => Response.json({
    Status: 0, Answer: [{ type: 1, data: '0.0.0.0' }], Comment: ['EDE(16): Censored']
  }));
  assert.deepEqual((await check('listed')).matches, ['Threat filter block']);
  dns.mock.mockImplementation(async () => Response.json({ Status: 3 }));
  await check('inconclusive');
  dns.mock.mockImplementation(async () => Response.json({}, { status: 502 }));
  await assert.rejects(check('inconclusive'), { status: 503 });

  process.env.GOOGLE_WEB_RISK_KEY = 'test-key';
  dns.mock.mockImplementation(async url => {
    assert.equal(url.hostname, 'webrisk.googleapis.com');
    assert.equal(url.searchParams.get('uri'), 'https://example.com/some-path');
    assert.equal(url.searchParams.getAll('threatTypes').length, 3);
    return Response.json({ threat: { threatTypes: ['SOCIAL_ENGINEERING'] } });
  });
  assert.deepEqual((await check('listed', 'url')).matches, ['SOCIAL_ENGINEERING']);
  dns.mock.mockImplementation(async url => url.hostname === 'webrisk.googleapis.com'
    ? Response.json({}, { status: 403 })
    : Response.json({ Status: 0, Answer: [{ type: 1, data: '93.184.215.14' }] }));
  await check('no_match');
});
