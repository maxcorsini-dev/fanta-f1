require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { initDatabase, pool } = require('./database');

const app = express();

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files solo in sviluppo locale
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
}

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

// Cron endpoint chiamato da Vercel Crons
app.get('/api/cron/update-races', async (req, res) => {
  // Verifica che la chiamata venga da Vercel
  if (process.env.NODE_ENV === 'production' && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { updateRaceStatuses } = require('./jolpica');
    await updateRaceStatuses();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Redirect root in locale
app.get('/', (req, res) => res.redirect('/index.html'));

// Inizializza DB una volta sola (connection pooling gestisce il resto)
let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await initDatabase();
    dbReady = true;
  }
};

// Middleware per inizializzare DB prima di ogni richiesta
app.use(async (req, res, next) => {
  try { await ensureDb(); next(); } catch (e) { res.status(500).json({ error: 'DB error' }); }
});

// Avvio locale
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  ensureDb().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🏎️  Fanta F1 2026 - Porta ${PORT}`));
  });
}

module.exports = app;
