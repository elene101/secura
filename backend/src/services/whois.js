// დომენის ვადა WHOIS-ით (იმ ზონებისთვის, რომლებსაც RDAP არ აქვთ, მაგ. .ge). მცდელობაა საუკეთესო ძალისხმევით: ფორმატი რეესტრის მიხედვით განსხვავდება
const net = require('net');
const { safeLookup } = require('./netsafe');

function query(host, q, port = 43, timeout = 6000) {
  return new Promise((resolve, reject) => {
    if (!/^[a-z0-9.-]{3,253}$/i.test(host)) return reject(new Error('bad host'));
    const s = net.connect({ host, port, lookup: safeLookup, timeout }); let out = '';
    const deadline = setTimeout(() => { s.destroy(); reject(new Error('timeout')); }, timeout);
    s.once('close', () => clearTimeout(deadline));
    s.on('connect', () => s.write(q + '\r\n'));
    s.on('data', d => { out += d; if (out.length > 100000) s.destroy(); });
    s.on('close', () => resolve(out));
    s.on('timeout', () => { s.destroy(); reject(new Error('timeout')); });
    s.on('error', reject);
  });
}
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function toDate(s) { // მხოლოდ ცალსახა ფორმატები. DD/MM და MM/DD ორაზროვანია, ამიტომ არ ვხვდებით
  let m, d;
  if ((m = /(\d{4})[-./](\d{2})[-./](\d{2})/.exec(s))) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  else if ((m = /(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{4})/.exec(s)) && m[2].toLowerCase() in MONTHS) d = new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  else if ((m = /(\d{2})[./-](\d{2})[./-](\d{4})/.exec(s)) && (+m[1] > 12 || +m[2] > 12)) d = +m[1] > 12 ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return d && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100 && !Number.isNaN(+d) ? d : null;
}
function parseExpiry(text) {
  const re = /^\s*(?:registry expiry date|registrar registration expiration date|expiry date|expiration date|expires(?: on)?|paid-till|renewal date|valid until)\s*[:.]*\s*(.+)$/gim;
  for (let m; (m = re.exec(text));) { const d = toDate(m[1]); if (d) return d; }
  return null;
}
async function whoisExpiry(domain, { iana = 'whois.iana.org', port = 43 } = {}) {
  const iOut = await query(iana, domain.split('.').pop(), port);
  const server = (/^\s*whois:\s*(\S+)/im.exec(iOut) || [])[1]; if (!server) return null;
  const d = parseExpiry(await query(server, domain, port)); if (!d) return null;
  return { expires: d.toISOString(), days: Math.floor((d - Date.now()) / 864e5), source: 'whois' };
}
module.exports = { query, parseExpiry, whoisExpiry };
