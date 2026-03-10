const express = require('express');
const { query, get, run } = require('../database');
const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non autenticato' });
  next();
}

router.get('/races', requireAuth, async (req, res) => {
  const season = await get('SELECT id FROM seasons WHERE is_active = 1');
  const races = await query('SELECT * FROM races WHERE season_id = $1 ORDER BY round', [season.id]);
  for (const race of races) {
    const p = await get('SELECT COUNT(*) as c FROM predictions WHERE race_id = $1 AND user_id = $2', [race.id, req.session.userId]);
    const paid = await get("SELECT COUNT(*) as c FROM payments WHERE race_id = $1 AND user_id = $2 AND status = 'completed'", [race.id, req.session.userId]);
    race.has_prediction = parseInt(p.c) > 0 ? 1 : 0;
    race.has_paid = parseInt(paid.c) > 0 ? 1 : 0;
  }
  res.json(races);
});

router.get('/races/:id', requireAuth, async (req, res) => {
  const race = await get('SELECT * FROM races WHERE id = $1', [req.params.id]);
  if (!race) return res.status(404).json({ error: 'Gara non trovata' });
  const season = await get('SELECT id FROM seasons WHERE is_active = 1');
  const drivers = await query('SELECT * FROM drivers WHERE season_id = $1 ORDER BY team, number', [season.id]);
  for (const d of drivers) {
    const prev = await get('SELECT * FROM previous_year_results WHERE race_name ILIKE $1 AND driver_code = $2', [`%${race.country}%`, d.code]);
    d.prev_position = prev?.position || null;
    d.prev_dnf = prev?.is_dnf || 0;
  }
  const existingPredictions = await query('SELECT * FROM predictions WHERE user_id = $1 AND race_id = $2', [req.session.userId, req.params.id]);
  res.json({ race, drivers, existingPredictions });
});

router.post('/races/:id/predict', requireAuth, async (req, res) => {
  const raceId = parseInt(req.params.id);
  const userId = req.session.userId;
  const race = await get('SELECT * FROM races WHERE id = $1', [raceId]);
  if (!race) return res.status(404).json({ error: 'Gara non trovata' });
  if (race.status !== 'open') return res.status(400).json({ error: 'Pronostici chiusi' });

  const { predictions, pole_driver_id } = req.body;
  const positions = predictions.filter(p => !p.is_dnf).map(p => p.predicted_position);
  if (new Set(positions).size !== positions.length) return res.status(400).json({ error: 'Posizione duplicata' });

  await run('DELETE FROM predictions WHERE user_id = $1 AND race_id = $2', [userId, raceId]);
  for (const pred of predictions) {
    await run(`INSERT INTO predictions (user_id, race_id, driver_id, predicted_position, is_dnf_prediction, is_pole_prediction)
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, raceId, pred.driver_id, pred.is_dnf ? null : pred.predicted_position,
       pred.is_dnf ? 1 : 0, pred.driver_id === pole_driver_id ? 1 : 0]);
  }
  res.json({ success: true, message: 'Pronostici salvati!' });
});

router.get('/leaderboard', async (req, res) => {
  const users = await query(`
    SELECT u.id, u.username,
      COALESCE(SUM(s.base_score + s.total), 0) as season_score,
      COUNT(s.id) as races_played
    FROM users u LEFT JOIN scores s ON s.user_id = u.id
    WHERE u.is_admin = 0 GROUP BY u.id ORDER BY season_score DESC`);
  res.json(users);
});

router.get('/races/:id/leaderboard', async (req, res) => {
  const scores = await query(`
    SELECT u.username, s.base_score, s.total, s.bonus_points, s.malus_points,
      s.position_points, s.dnf_points, s.breakdown, (s.base_score + s.total) as race_score
    FROM scores s JOIN users u ON u.id = s.user_id
    WHERE s.race_id = $1 ORDER BY race_score DESC`, [req.params.id]);
  res.json(scores);
});

router.get('/my-scores', requireAuth, async (req, res) => {
  const scores = await query(`
    SELECT s.*, r.name as race_name, r.round, r.date, (s.base_score + s.total) as race_score
    FROM scores s JOIN races r ON r.id = s.race_id
    WHERE s.user_id = $1 ORDER BY r.round`, [req.session.userId]);
  res.json(scores);
});

router.get('/races/:id/results', async (req, res) => {
  const results = await query(`
    SELECT rr.position, rr.is_dnf, rr.is_pole, d.full_name, d.team, d.number
    FROM race_results rr JOIN drivers d ON d.id = rr.driver_id
    WHERE rr.race_id = $1 ORDER BY rr.is_dnf ASC, rr.position ASC`, [req.params.id]);
  res.json(results);
});

module.exports = router;
