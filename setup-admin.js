require('dotenv').config();
const bcrypt = require('bcryptjs');
const [,, username, email, password] = process.argv;
if (!username || !email || !password) { console.log('Uso: node setup-admin.js <username> <email> <password>'); process.exit(1); }
async function main() {
  const { get, run, initDatabase } = require('./database');
  await initDatabase();
  const hashed = await bcrypt.hash(password, 10);
  const ex = await get('SELECT id FROM users WHERE username=$1', [username]);
  if (ex) { await run('UPDATE users SET is_admin=1, password=$1 WHERE username=$2', [hashed, username]); console.log(`✅ "${username}" aggiornato ad admin`); }
  else { await run('INSERT INTO users (username,email,password,is_admin) VALUES ($1,$2,$3,1)', [username, email, hashed]); console.log(`✅ Admin "${username}" creato`); }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
