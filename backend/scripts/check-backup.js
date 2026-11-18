const { DatabaseSync } = require('node:sqlite');
const { resolve } = require('node:path');
const { statSync } = require('node:fs');

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/check-backup.js <backup.sqlite>');
const source = resolve(file);
if (!statSync(source).isFile()) throw new Error('Expected a SQLite backup file');
const database = new DatabaseSync(source, { readOnly: true });
try {
  const integrity = database.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
  const counts = database.prepare('SELECT kind, COUNT(*) AS records FROM docs GROUP BY kind ORDER BY kind').all();
  console.log(JSON.stringify({ integrity: 'ok', counts }));
} finally { database.close(); }
