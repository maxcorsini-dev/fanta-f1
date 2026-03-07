require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const cron = require('node-cron');
const { initDatabase, pool } = require('./database');
const { updateRaceStatuses } = require('./jolpica');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new pgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'fanta-f1-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/game', require('./routes/game'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/paypal', require('./routes/paypal'));

app.get('/', (req, res) => res.redirect('/index.html'));
app.get('*', (req, res) => {
  if (!req.path.includes('.')) res.redirect('/index.html');
  else res.status(404).send('Not found');
});

cron.schedule('*/5 * * * *', () => updateRaceStatuses());

async function setupAdminIfNeeded() {
  const adminEnv = process.env.SETUP_ADMIN;
  if (!adminEnv) return;
  const [username, email, password] = adminEnv.split(':');
  const bcrypt = require('bcryptjs');
  const { get, run } = require('./database');
  const hashed = await bcrypt.hash(password, 10);
  const ex = await get('SELECT id FROM users WHERE username=$1', [username]);
  if (ex) await run('UPDATE users SET is_admin=1, password=$1 WHERE username=$2', [hashed, username]);
  else await run('INSERT INTO users (username,email,password,is_admin) VALUES ($1,$2,$3,1)', [username, email, hashed]);
  console.log(`✅ Admin "${username}" pronto`);
}

async function start() {
  await initDatabase();
  await setupAdminIfNeeded();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏎️  Fanta F1 2026 - Porta ${PORT}`);
  });
}

start().catch(err => { console.error('Errore avvio:', err); process.exit(1); });
