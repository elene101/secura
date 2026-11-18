// მონაცემები SQLite-შია (node:sqlite, დამატებითი ბიბლიოთეკა არ სჭირდება). ჩაწერა ტრანზაქციულია და ავარიისგან დაცული (WAL).
// თუ Node ძველია (22.13-ზე დაბალი), დროებით ძველ db.json რეჟიმზე გადადის. ძველი db.json ავტომატურად გადმოაქვს ბაზაში.
const fs = require('fs'), crypto = require('crypto');
const KINDS = ['users', 'sites', 'orders', 'reviews', 'audit', 'notifications', 'workspaces', 'shares', 'system'];
const id = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');
const FILE = process.env.DB_PATH || 'data.sqlite';

let sql = null;
try {
  const { DatabaseSync } = require('node:sqlite');
  sql = new DatabaseSync(FILE);
  sql.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS docs (kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (kind, id));');
  try { fs.chmodSync(FILE, 0o600); } catch {}
} catch (error) { if (process.env.NODE_ENV === 'production') throw error; console.warn('SQLite unavailable: using db.json'); }

const db = Object.fromEntries(KINDS.map(k => [k, []])), saved = Object.fromEntries(KINDS.map(k => [k, new Map()]));
const legacy = () => { try { return fs.existsSync('db.json') ? JSON.parse(fs.readFileSync('db.json')) : null; } catch { return null; } };

if (sql) {
  for (const r of sql.prepare('SELECT kind, id, json FROM docs ORDER BY rowid').all()) if (db[r.kind]) { db[r.kind].push(JSON.parse(r.json)); saved[r.kind].set(r.id, r.json); }
  const duplicate = sql.prepare("SELECT 1 FROM docs WHERE kind='users' GROUP BY lower(json_extract(json,'$.email')) HAVING count(*)>1").get();
  if (duplicate) {
    if (process.env.NODE_ENV === 'production') throw new Error('Resolve duplicate user emails before startup');
    console.warn('Resolve duplicate user emails before deploying');
  } else {
    sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS unique_user_email ON docs(lower(json_extract(json,'$.email'))) WHERE kind='users'");
  }
} else Object.assign(db, legacy() || {});

function save() {
  if (!sql) { const tmp = 'db.json.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 }); return fs.renameSync(tmp, 'db.json'); }
  const ups = [], dels = [];
  for (const k of KINDS) {
    const seen = new Set();
    for (const item of db[k]) {
      item.id ||= id(); seen.add(item.id); const j = JSON.stringify(item);
      if (saved[k].get(item.id) !== j) ups.push([k, item.id, j]);
    }
    for (const sid of saved[k].keys()) if (!seen.has(sid)) dels.push([k, sid]);
  }
  if (!ups.length && !dels.length) return;
  const up = sql.prepare('INSERT INTO docs (kind, id, json) VALUES (?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET json = excluded.json'), del = sql.prepare('DELETE FROM docs WHERE kind = ? AND id = ?');
  sql.exec('BEGIN');
  try { for (const u of ups) up.run(...u); for (const d of dels) del.run(...d); sql.exec('COMMIT'); }
  catch (e) { sql.exec('ROLLBACK'); throw e; }
  for (const [k, i, j] of ups) saved[k].set(i, j); for (const [k, i] of dels) saved[k].delete(i);
}

if (sql && !sql.prepare('SELECT 1 FROM docs LIMIT 1').get()) { // ძველი db.json -> SQLite (ერთჯერადად)
  const old = legacy();
  if (old) { for (const k of KINDS) db[k] = old[k] || []; save(); fs.renameSync('db.json', 'db.json.migrated'); console.log('Migrated db.json to SQLite (original kept as db.json.migrated)'); }
}
for (const u of db.users) if (u.emailVerified === undefined) u.emailVerified = !!(u.oauth || u.githubId); // ძველი ანგარიშების მიგრაცია

const backupExt = sql ? 'sqlite' : 'json';
function backupTo(file) {
  if (!sql) return fs.copyFileSync('db.json', file);
  const temporary = file + '.new';
  fs.rmSync(temporary, { force: true });
  sql.exec(`VACUUM INTO '${temporary.replace(/'/g, "''")}'`);
  fs.renameSync(temporary, file);
}
module.exports = { db, save, id, backupTo, backupExt };
