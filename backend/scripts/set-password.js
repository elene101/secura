const { db, save } = require('../src/config/db');
const { hash } = require('../src/helpers/crypto');
const { validatePassword } = require('../src/validators/auth.validator');

async function changePassword() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error('Usage: npm run set-password -- email new-password (stop the server first)');
  const user = db.users.find(item => item.email === email.toLowerCase());
  if (!user) throw new Error('No such account');
  validatePassword(password, user.email);
  user.pass = await hash(password);
  user.tv = (user.tv || 0) + 1;
  for (const key of ['mfaChallenge', 'resetHash', 'resetExp', 'resetExpiresAt']) delete user[key];
  save();
  console.log('Password changed.');
}
changePassword().catch(error => { console.error(error.message); process.exitCode = 1; });
