const express = require('express');
const { query, get, run } = require('../database');
const { fetchCalendar, fetchDrivers, fetchRaceResults, fetchPreviousYearResults } = require('../openf1');
const { calculateScores } = require('../scoring');
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
    res.json({ success: true, message: `Risultati importati. ${scores.length} punteggi calcolati.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/races/:id/recalculate', requireAdmin, async (req, res) => {
  try { const s = await calculateScores(parseInt(req.params.id)); res.json({ success: true, message: `${s.length} punteggi ricalcolati` }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sync/previous-year', requireAdmin, async (req, res) => {
  try { await fetchPreviousYearResults(2026); res.json({ success: true, message: 'Storico 2025 importato' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/payments', requireAdmin, async (req, res) => {
  res.json(await query(`SELECT p.*, u.username, r.name as race_name FROM payments p
    JOIN users u ON u.id = p.user_id JOIN races r ON r.id = p.race_id ORDER BY p.created_at DESC`));
});

router.post('/payments/:id/complete', requireAdmin, async (req, res) => {
  await run("UPDATE payments SET status = 'completed', completed_at = $1 WHERE id = $2", [new Date().toISOString(), req.params.id]);
  res.json({ success: true });
});

router.post('/races/reset-statuses', requireAdmin, async (req, res) => {
  await run("UPDATE races SET status = 'upcoming'", []);
  res.json({ success: true, message: 'Tutte le gare resettate a upcoming' });
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
