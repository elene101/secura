const { isIP } = require('node:net');
const { normalizeUrl } = require('../services/scanner');
const { publicUrl } = require('../services/scan-work');
const { UserError } = require('../helpers/errors');

const DNS_SOURCE = 'Cloudflare 1.1.1.1 for Families';
const GOOGLE_SOURCE = 'Google Cloud Web Risk';

async function getJson(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(3600), redirect: 'error' });
  if (!response.ok) throw new Error('Lookup was not accepted');
  return response.json();
}

async function lookupWebRisk(uri, key) {
  const url = new URL('https://webrisk.googleapis.com/v1/uris:search');
  url.searchParams.set('key', key);
  url.searchParams.set('uri', uri);
  for (const type of ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE']) url.searchParams.append('threatTypes', type);
  const data = await getJson(url);
  const matches = data.threat ? data.threat.threatTypes : [];
  if (!Array.isArray(matches) || !matches.every(value => typeof value === 'string')) throw new Error('Invalid Web Risk response');
  return { status: matches.length ? 'listed' : 'no_match', matches, source: GOOGLE_SOURCE, scope: 'url' };
}

async function lookupDns(hostname) {
  const result = { source: DNS_SOURCE, scope: 'domain', matches: [], status: 'inconclusive' };
  if (isIP(hostname.replace(/^\[|\]$/g, ''))) return result;

  for (const type of ['A', 'AAAA']) {
    const url = new URL('https://security.cloudflare-dns.com/dns-query');
    url.searchParams.set('name', hostname);
    url.searchParams.set('type', type);
    const data = await getJson(url, { Accept: 'application/dns-json' });
    if (typeof data.Status !== 'number' || data.TC === true) throw new Error('Invalid DNS response');
    if (data.Status !== 0) return result;
    const addresses = (data.Answer || []).filter(answer => answer.type === (type === 'A' ? 1 : 28))
      .map(answer => answer.data).filter(address => isIP(address));
    const sinkhole = address => address === '0.0.0.0' || address === '::';
    const comments = Array.isArray(data.Comment) ? data.Comment : [data.Comment];
    if (addresses.some(sinkhole)) {
      if (comments.some(comment => /^EDE\((15|16)\):/.test(comment || ''))) {
        return { ...result, status: 'listed', matches: ['Threat filter block'] };
      }
      return result;
    }
    if (addresses.length) return { ...result, status: 'no_match' };
  }
  return result;
}

exports.lookup = async (req, res) => {
  const url = normalizeUrl(req.body.url);
  const key = process.env.GOOGLE_WEB_RISK_KEY?.trim();
  if (key) {
    try {
      return res.json({ ...await lookupWebRisk(publicUrl(url.href), key), checkedAt: new Date().toISOString() });
    } catch { /* Fall back to a domain-only result if Web Risk is unavailable. */ }
  }
  try {
    res.json({ ...await lookupDns(url.hostname), checkedAt: new Date().toISOString() });
  } catch {
    throw new UserError('Reputation check is temporarily unavailable', 503);
  }
};
