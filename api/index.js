require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { initDatabase, pool } = require('../database');

const app = express();

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files sempre (Vercel li servirà dalla CDN, ma serve anche in locale)
app.use(express.static(path.join(__dirname, '../public')));

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

// Inizializza DB prima di tutto
let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await initDatabase();
    dbReady = true;
  }
};

app.use(async (req, res, next) => {
  try { await ensureDb(); next(); } catch (e) { res.status(500).json({ error: 'DB non disponibile: ' + e.message }); }
});

app.use('/api/auth', require('../routes/auth'));
app.use('/api/game', require('../routes/game'));
app.use('/api/admin', require('../routes/admin'));
app.use('/api/paypal', require('../routes/paypal'));

// Cron endpoint
app.get('/api/cron/update-races', async (req, res) => {
  if (process.env.NODE_ENV === 'production' && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { updateRaceStatuses } = require('../jolpica');
    await updateRaceStatuses();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Setup admin via variabile d'ambiente
app.get('/api/setup', async (req, res) => {
  const adminEnv = process.env.SETUP_ADMIN;
  if (!adminEnv) return res.json({ message: 'Nessun admin da creare' });
  const [username, email, password] = adminEnv.split(':');
  const bcrypt = require('bcryptjs');
  const { get, run } = require('../database');
  const hashed = await bcrypt.hash(password, 10);
  const ex = await get('SELECT id FROM users WHERE username=$1', [username]);
  if (ex) await run('UPDATE users SET is_admin=1, password=$1 WHERE username=$2', [hashed, username]);
  else await run('INSERT INTO users (username,email,password,is_admin) VALUES ($1,$2,$3,1)', [username, email, hashed]);
  res.json({ ok: true, message: `Admin "${username}" pronto` });
});

app.get('/', (req, res) => res.redirect('/index.html'));

// Avvio locale
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  ensureDb().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🏎️  Fanta F1 2026 - Porta ${PORT}`));
  });
}

module.exports = app;
