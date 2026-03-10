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

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new pgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'fanta-f1-secret',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: 'auto',
    sameSite: 'lax'
  }
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/game', require('./routes/game'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/paypal', require('./routes/paypal'));

// Setup admin via variabile d'ambiente
// Espone il PayPal Client ID al frontend in modo sicuro
app.get('/api/config', (req, res) => {
  res.json({ paypalClientId: process.env.PAYPAL_CLIENT_ID || '' });
});

app.get('/api/setup', async (req, res) => {
  const adminEnv = process.env.SETUP_ADMIN;
  if (!adminEnv) return res.json({ message: 'Nessun admin da creare' });
  const [username, email, password] = adminEnv.split(':');
  const bcrypt = require('bcryptjs');
  const { get, run } = require('./database');
  const hashed = await bcrypt.hash(password, 10);
  const ex = await get('SELECT id FROM users WHERE username=$1', [username]);
  if (ex) await run('UPDATE users SET is_admin=1, password=$1 WHERE username=$2', [hashed, username]);
  else await run('INSERT INTO users (username,email,password,is_admin) VALUES ($1,$2,$3,1)', [username, email, hashed]);
  res.json({ ok: true, message: `Admin "${username}" pronto` });
});

app.get('/', (req, res) => res.redirect('/index.html'));
app.get('*', (req, res) => {
  if (!req.path.includes('.')) res.redirect('/index.html');
  else res.status(404).send('Not found');
});

cron.schedule('*/5 * * * *', () => updateRaceStatuses());

async function start() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏎️  Fanta F1 2026 - Porta ${PORT}`);
  });
}

start().catch(err => { console.error('Errore avvio:', err); process.exit(1); });
