const express = require('express');
const axios = require('axios');
const { get, run } = require('../database');
const { sendPaymentReceipt } = require('../mailer');
const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non autenticato' });
  next();
}

const PAYPAL_BASE = process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

async function getToken() {
  const res = await axios.post(`${PAYPAL_BASE}/v1/oauth2/token`, 'grant_type=client_credentials', {
    auth: { username: process.env.PAYPAL_CLIENT_ID, password: process.env.PAYPAL_CLIENT_SECRET },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return res.data.access_token;
}

router.post('/create-order', requireAuth, async (req, res) => {
  const { race_id } = req.body;
  const race = await get('SELECT * FROM races WHERE id = $1', [race_id]);
  if (!race) return res.status(404).json({ error: 'Gara non trovata' });
  const existing = await get("SELECT id FROM payments WHERE user_id = $1 AND race_id = $2 AND status = 'completed'", [req.session.userId, race_id]);
  if (existing) return res.json({ success: false, message: 'Hai già pagato' });
  // Rimuove eventuali pending precedenti per evitare orfani
  await run("DELETE FROM payments WHERE user_id = $1 AND race_id = $2 AND status = 'pending'", [req.session.userId, race_id]);
  try {
    const token = await getToken();
    const order = await axios.post(`${PAYPAL_BASE}/v2/checkout/orders`, {
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'EUR', value: '1.00' }, description: `Fanta F1 2026 - ${race.name}` }],
      application_context: { brand_name: 'Fanta F1 2026', locale: 'it-IT', user_action: 'PAY_NOW',
        return_url: `${process.env.BASE_URL}/payment-success.html`, cancel_url: `${process.env.BASE_URL}/dashboard.html` }
    }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    await run('INSERT INTO payments (user_id, race_id, paypal_order_id, amount, status) VALUES ($1,$2,$3,1.00,$4)',
      [req.session.userId, race_id, order.data.id, 'pending']);
    res.json({ success: true, orderId: order.data.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/capture-order', requireAuth, async (req, res) => {
  try {
    const token = await getToken();
    const capture = await axios.post(`${PAYPAL_BASE}/v2/checkout/orders/${req.body.order_id}/capture`, {},
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    if (capture.data.status === 'COMPLETED') {
      const captureId = capture.data.purchase_units[0].payments.captures[0].id;
      await run("UPDATE payments SET status='completed', paypal_capture_id=$1, completed_at=$2 WHERE paypal_order_id=$3 AND user_id=$4",
        [captureId, new Date().toISOString(), req.body.order_id, req.session.userId]);
      const payment = await get(`SELECT p.race_id, r.name as race_name, u.email, u.username
        FROM payments p JOIN races r ON r.id = p.race_id JOIN users u ON u.id = p.user_id
        WHERE p.paypal_order_id = $1`, [req.body.order_id]);
      if (payment) sendPaymentReceipt(payment.email, payment.username, payment.race_name, '1.00');
      res.json({ success: true });
    } else { res.json({ success: false, message: capture.data.status }); }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/status/:race_id', requireAuth, async (req, res) => {
  const p = await get("SELECT id FROM payments WHERE user_id=$1 AND race_id=$2 AND status='completed'", [req.session.userId, req.params.race_id]);
  res.json({ paid: !!p });
});

module.exports = router;
