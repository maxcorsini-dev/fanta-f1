const express = require('express');
const bcrypt = require('bcryptjs');
const { query, get, run } = require('../database');
const { sendWelcome } = require('../mailer');
const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, email, password, confirm_password } = req.body;
  if (!username || !email || !password) return res.json({ success: false, message: 'Tutti i campi sono obbligatori' });
  if (password !== confirm_password) return res.json({ success: false, message: 'Le password non coincidono' });
  if (password.length < 6) return res.json({ success: false, message: 'Password troppo corta (minimo 6 caratteri)' });

  const existing = await get('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email.toLowerCase()]);
  if (existing) return res.json({ success: false, message: 'Username o email già in uso' });

  const hashed = await bcrypt.hash(password, 10);
  const user = await get('INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id', [username, email.toLowerCase(), hashed]);

  req.session.userId = user.id;
  req.session.username = username;
  req.session.isAdmin = false;
  sendWelcome(email.toLowerCase(), username);
  res.json({ success: true, redirect: '/dashboard.html' });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await get('SELECT * FROM users WHERE username = $1', [username]);
  if (!user) return res.json({ success: false, message: 'Credenziali errate' });
  if (!await bcrypt.compare(password, user.password)) return res.json({ success: false, message: 'Credenziali errate' });
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.isAdmin = user.is_admin === 1;
  res.json({ success: true, redirect: user.is_admin ? '/admin.html' : '/dashboard.html' });
});

router.post('/logout', (req, res) => { req.session.destroy(); res.json({ success: true, redirect: '/' }); });

router.get('/me', async (req, res) => {
  if (!req.session.userId) return res.json({ logged: false });
  const user = await get('SELECT id, username, email, is_admin, total_score FROM users WHERE id = $1', [req.session.userId]);
  res.json({ logged: true, user });
});

module.exports = router;
