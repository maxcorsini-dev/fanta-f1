require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const cron = require('node-cron');
const { initDatabase, pool, query, get } = require('./database');
const { updateRaceStatuses } = require('./openf1');
const { sendDeadlineReminder } = require('./mailer');

const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Troppi tentativi. Riprova tra 15 minuti.' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, message: 'Troppe richieste. Riprova tra un minuto.' },
  standardHeaders: true,
  legacyHeaders: false
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, message: 'Troppe richieste admin. Riprova tra un minuto.' },
  standardHeaders: true,
  legacyHeaders: false
});
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

app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/game', apiLimiter, require('./routes/game'));
app.use('/api/admin', adminLimiter, require('./routes/admin'));
app.use('/api/paypal', apiLimiter, require('./routes/paypal'));

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

// Reminder deadline: ogni ora controlla gare che scadono nelle prossime 24h
cron.schedule('0 * * * *', async () => {
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const races = await query(
      "SELECT id, name, deadline FROM races WHERE status = 'open' AND deadline > $1 AND deadline <= $2",
      [now.toISOString().replace('T', ' ').substring(0, 19), in24h.toISOString().replace('T', ' ').substring(0, 19)]
    );
    for (const race of races) {
      const users = await query(`
        SELECT u.id, u.email, u.username FROM users u
        WHERE u.is_admin = 0
        AND u.id NOT IN (SELECT DISTINCT user_id FROM predictions WHERE race_id = $1)
      `, [race.id]);
      for (const user of users) {
        sendDeadlineReminder(user.email, user.username, race.name, race.deadline);
      }
    }
  } catch (e) {
    console.warn('⚠️ Errore cron reminder deadline:', e.message);
  }
});

async function start() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏎️  Fanta F1 2026 - Porta ${PORT}`);
  });
}

start().catch(err => { console.error('Errore avvio:', err); process.exit(1); });
