const { UserError } = require('../helpers/errors');

let active = 0;
const waiting = [];
const CAPACITY = 12;
const MAX_QUEUED = 36;

const hostBudget = new Map();
const WINDOW = 3600000;
let cleanupAt = 0;
function reserveHost(host) {
  const now = Date.now();
  if (now >= cleanupAt) {
    for (const [name, bucket] of hostBudget) if (now >= bucket.until) hostBudget.delete(name);
    cleanupAt = now + 60000;
  }
  let bucket = hostBudget.get(host);
  if (!bucket || now >= bucket.until) {
    if (!bucket && hostBudget.size >= 5000) throw new UserError('Scanner is busy. Try again shortly.', 503);
    bucket = { count: 0, until: now + WINDOW };
    hostBudget.set(host, bucket);
  }
  if (bucket.count >= 120) throw new UserError('Scanning this site too often, try again later', 429);
  bucket.count++;
}

async function safeWork(host, job) {
  reserveHost(host);
  if (active >= CAPACITY) {
    if (waiting.length >= MAX_QUEUED) throw new UserError('Scanner is busy. Try again shortly.', 503);
    await new Promise(resolve => waiting.push(resolve));
  } else {
    active++;
  }
  try {
    return await job();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

function publicUrl(raw) {
  const url = new URL(raw);
  return url.origin + url.pathname;
}

module.exports = { safeWork, publicUrl };
