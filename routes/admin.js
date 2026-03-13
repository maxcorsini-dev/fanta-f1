const express = require('express');
const { query, get, run } = require('../database');
const { fetchCalendar, fetchDrivers, fetchRaceResults, fetchPreviousYearResults } = require('../openf1');
const { calculateScores } = require('../scoring');
const { sendScoresReady } = require('../mailer');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin) return res.status(403).json({ error: 'Non autorizzato' });
  next();
}

router.get('/stats', requireAdmin, async (req, res) => {
  const season = await get('SELECT id FROM seasons WHERE is_active = 1');
  const users = await get('SELECT COUNT(*) as c FROM users WHERE is_admin = 0');
  const races = season ? await get('SELECT COUNT(*) as c FROM races WHERE season_id = $1', [season.id]) : { c: 0 };
  const completed = await get("SELECT COUNT(*) as c FROM races WHERE status = 'completed'");
  const revenue = await get("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'completed'");
  res.json({ users: users.c, total_races: races.c, completed_races: completed.c, total_revenue: revenue.total });
});

router.get('/users', requireAdmin, async (req, res) => {
  res.json(await query('SELECT id, username, email, is_admin, total_score, created_at FROM users ORDER BY total_score DESC'));
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  await run('DELETE FROM predictions WHERE user_id = $1', [id]);
  await run('DELETE FROM scores WHERE user_id = $1', [id]);
  await run('DELETE FROM payments WHERE user_id = $1', [id]);
  await run('DELETE FROM users WHERE id = $1', [id]);
  res.json({ success: true });
});

router.post('/sync/calendar', requireAdmin, async (req, res) => {
  try { res.json({ success: true, message: `${await fetchCalendar(2026)} gare importate` }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sync/drivers', requireAdmin, async (req, res) => {
  try { res.json({ success: true, message: `${await fetchDrivers(2026)} piloti aggiornati` }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/races/:id/fetch-results', requireAdmin, async (req, res) => {
  try {
    const race = await get('SELECT * FROM races WHERE id = $1', [req.params.id]);
    if (!race) return res.status(404).json({ error: 'Gara non trovata' });
    await fetchRaceResults(2026, race.jolpica_round);
    const scores = await calculateScores(parseInt(req.params.id));
    // Notifica ogni partecipante con il suo punteggio
    for (const s of scores) {
      const user = await get('SELECT email, username FROM users WHERE id = $1', [s.userId]);
      const score = await get('SELECT total, breakdown FROM scores WHERE user_id = $1 AND race_id = $2', [s.userId, parseInt(req.params.id)]);
      if (user && score) {
        const breakdown = JSON.parse(score.breakdown || '[]');
        sendScoresReady(user.email, user.username, race.name, score.total, breakdown);
      }
    }
    res.json({ success: true, message: `Risultati importati. ${scores.length} punteggi calcolati.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/races/:id/recalculate', requireAdmin, async (req, res) => {
  try { const s = await calculateScores(parseInt(req.params.id)); res.json({ success: true, message: `${s.length} punteggi ricalcolati` }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sync/clean-drivers', requireAdmin, async (req, res) => {
  try {
    const season = await get('SELECT id FROM seasons WHERE is_active = 1');
    // I vecchi ID Jolpica erano testuali (es. "max_verstappen"), quelli OpenF1 sono numerici
    const old = await query("SELECT id FROM drivers WHERE season_id=$1 AND jolpica_id !~ '^[0-9]+$'", [season.id]);
    const oldIds = old.map(d => d.id);
    if (!oldIds.length) return res.json({ success: true, message: 'Nessun pilota duplicato trovato' });
    await run(`DELETE FROM predictions WHERE driver_id = ANY($1)`, [oldIds]);
    await run(`DELETE FROM race_results WHERE driver_id = ANY($1)`, [oldIds]);
    await run(`DELETE FROM drivers WHERE id = ANY($1)`, [oldIds]);
    res.json({ success: true, message: `Rimossi ${oldIds.length} piloti duplicati (vecchio formato Jolpica)` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sync/previous-year', requireAdmin, async (req, res) => {
  try { await fetchPreviousYearResults(2026); res.json({ success: true, message: 'Storico 2025 importato' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/payments', requireAdmin, async (req, res) => {
  res.json(await query(`SELECT p.*, u.username, r.name as race_name FROM payments p
    JOIN users u ON u.id = p.user_id JOIN races r ON r.id = p.race_id ORDER BY p.created_at DESC`));
});

router.post('/payments/cleanup-pending', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      "DELETE FROM payments WHERE status = 'pending' AND created_at < to_char(now() - interval '2 hours', 'YYYY-MM-DD HH24:MI:SS') RETURNING id"
    );
    res.json({ success: true, message: `${result.length} pagamenti pending rimossi` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/payments/:id/complete', requireAdmin, async (req, res) => {
  await run("UPDATE payments SET status = 'completed', completed_at = $1 WHERE id = $2", [new Date().toISOString(), req.params.id]);
  res.json({ success: true });
});

router.get('/races', requireAdmin, async (req, res) => {
  const season = await get('SELECT id FROM seasons WHERE is_active = 1');
  const races = await query('SELECT * FROM races WHERE season_id = $1 ORDER BY round', [season?.id]);
  for (const race of races) {
    const p = await get('SELECT COUNT(DISTINCT user_id) as c FROM predictions WHERE race_id = $1', [race.id]);
    race.participants = p.c;
  }
  res.json(races);
});

router.put('/races/:id', requireAdmin, async (req, res) => {
  await run('UPDATE races SET deadline = $1, status = $2 WHERE id = $3', [req.body.deadline, req.body.status, req.params.id]);
  res.json({ success: true });
});

// Reset manuale status gare (utile per correggere gare bloccate)
router.post('/races/reset-statuses', requireAdmin, async (req, res) => {
  try {
    const { updateRaceStatuses } = require('../openf1');
    // Prima resetta tutte a upcoming tranne completed
    await run("UPDATE races SET status='upcoming' WHERE status != 'completed'");
    // Poi applica la logica corretta
    await updateRaceStatuses();
    res.json({ success: true, message: 'Status gare aggiornati' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pronostici di un utente per una gara
router.get('/races/:id/predictions/:userId', requireAdmin, async (req, res) => {
  const predictions = await query(
    'SELECT * FROM predictions WHERE race_id = $1 AND user_id = $2',
    [req.params.id, req.params.userId]
  );
  res.json(predictions);
});

// Salva pronostici per conto di un utente (bypassa check status)
router.post('/races/:id/predict-for-user', requireAdmin, async (req, res) => {
  try {
    const raceId = parseInt(req.params.id);
    const { user_id, predictions, pole_driver_id } = req.body;
    if (!user_id || !predictions?.length) return res.status(400).json({ error: 'user_id e predictions sono obbligatori' });

    const positions = predictions.filter(p => !p.is_dnf).map(p => p.predicted_position);
    if (new Set(positions).size !== positions.length) return res.status(400).json({ error: 'Posizione duplicata' });

    await run('DELETE FROM predictions WHERE user_id = $1 AND race_id = $2', [user_id, raceId]);
    for (const pred of predictions) {
      await run(`INSERT INTO predictions (user_id, race_id, driver_id, predicted_position, is_dnf_prediction, is_pole_prediction)
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [user_id, raceId, pred.driver_id, pred.is_dnf ? null : pred.predicted_position,
         pred.is_dnf ? 1 : 0, pred.driver_id === pole_driver_id ? 1 : 0]);
    }
    res.json({ success: true, message: `Pronostici salvati per l'utente` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Risultati di una gara (per gestione incidenti)
router.get('/races/:id/results', requireAdmin, async (req, res) => {
  const results = await query(`
    SELECT rr.driver_id, rr.position, rr.is_dnf, rr.is_pole, rr.caused_incident,
      d.full_name, d.code, d.team
    FROM race_results rr
    JOIN drivers d ON d.id = rr.driver_id
    WHERE rr.race_id = $1
    ORDER BY rr.is_dnf ASC, rr.position ASC NULLS LAST
  `, [req.params.id]);
  res.json(results);
});

// Toggle caused_incident per un pilota in una gara
router.put('/races/:id/results/:driverId/incident', requireAdmin, async (req, res) => {
  const { caused_incident } = req.body;
  await run(
    'UPDATE race_results SET caused_incident = $1 WHERE race_id = $2 AND driver_id = $3',
    [caused_incident ? 1 : 0, req.params.id, req.params.driverId]
  );
  res.json({ success: true });
});

// Classifica giocatori con dettaglio per gara
router.get('/leaderboard-detail', requireAdmin, async (req, res) => {
  const users = await query(`
    SELECT u.id, u.username, u.total_score,
      COUNT(s.id) as races_played,
      COALESCE(SUM(s.base_score + s.total), 0) as season_score,
      MAX(s.base_score + s.total) as best_race,
      ROUND(AVG(s.base_score + s.total)::numeric, 1) as avg_score
    FROM users u
    LEFT JOIN scores s ON s.user_id = u.id
    WHERE u.is_admin = 0
    GROUP BY u.id
    ORDER BY season_score DESC`);
  res.json(users);
});

module.exports = router;
