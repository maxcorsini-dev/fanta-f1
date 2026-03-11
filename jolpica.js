const axios = require('axios');
const { query, get, run } = require('./database');

const BASE_URL = 'https://api.openf1.org/v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getDeadline(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 2); d.setHours(23, 59, 0, 0);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

async function fetchCalendar(year = 2026) {
  const [meetingsRes, sessionsRes] = await Promise.all([
    axios.get(`${BASE_URL}/meetings?year=${year}`, { timeout: 15000 }),
    axios.get(`${BASE_URL}/sessions?year=${year}&session_type=Race`, { timeout: 15000 })
  ]);

  const meetings = meetingsRes.data;
  const raceSessions = sessionsRes.data;

  // Map meeting_key -> race session
  const sessionMap = {};
  for (const s of raceSessions) sessionMap[s.meeting_key] = s;

  const season = await get('SELECT id FROM seasons WHERE year=$1', [year]);
  if (!season) throw new Error(`Stagione ${year} non trovata`);

  let count = 0;
  for (let i = 0; i < meetings.length; i++) {
    const m = meetings[i];
    const round = i + 1;
    const raceSession = sessionMap[m.meeting_key];
    const sessionKey = raceSession?.session_key || null;
    const dateStr = (raceSession?.date_start || m.date_start).substring(0, 10);
    const deadline = getDeadline(dateStr);

    const ex = await get('SELECT id FROM races WHERE season_id=$1 AND round=$2', [season.id, round]);
    if (!ex) {
      await run(
        `INSERT INTO races (season_id, round, name, circuit, country, date, deadline, jolpica_round) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [season.id, round, m.meeting_name, m.location, m.country_name, dateStr, deadline, sessionKey]
      );
      count++;
    } else {
      // Aggiorna sempre il session_key e i dati al re-sync
      await run(
        'UPDATE races SET name=$1, circuit=$2, country=$3, date=$4, jolpica_round=$5 WHERE id=$6',
        [m.meeting_name, m.location, m.country_name, dateStr, sessionKey, ex.id]
      );
    }
  }
  return count || meetings.length;
}

async function fetchDrivers(year = 2026) {
  const sessionsRes = await axios.get(`${BASE_URL}/sessions?year=${year}&session_type=Race`, { timeout: 15000 });
  const sessions = sessionsRes.data;
  if (!sessions.length) throw new Error(`Nessuna sessione trovata per il ${year}`);

  // Usa l'ultima sessione disponibile per avere i team aggiornati
  const latestSession = sessions[sessions.length - 1];
  const driversRes = await axios.get(`${BASE_URL}/drivers?session_key=${latestSession.session_key}`, { timeout: 15000 });
  const drivers = driversRes.data;

  const season = await get('SELECT id FROM seasons WHERE year=$1', [year]);
  if (!season) throw new Error(`Stagione ${year} non trovata`);

  for (const d of drivers) {
    const driverId = String(d.driver_number);
    const code = d.name_acronym || driverId;
    const fullName = d.full_name || `${d.first_name} ${d.last_name}`;
    const team = d.team_name || 'Unknown';

    const ex = await get('SELECT id FROM drivers WHERE season_id=$1 AND jolpica_id=$2', [season.id, driverId]);
    if (!ex) {
      await run(
        'INSERT INTO drivers (season_id, number, code, full_name, team, jolpica_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [season.id, d.driver_number, code, fullName, team, driverId]
      );
    } else {
      await run('UPDATE drivers SET team=$1, full_name=$2, code=$3 WHERE id=$4', [team, fullName, code, ex.id]);
    }
  }
  return drivers.length;
}

async function fetchRaceResults(year, sessionKey) {
  if (!sessionKey) throw new Error('session_key mancante. Risincronizza il calendario.');

  // Info sessione (serve il meeting_key per trovare le qualifiche)
  const sessionInfoRes = await axios.get(`${BASE_URL}/sessions?session_key=${sessionKey}`, { timeout: 15000 });
  const sessionInfo = sessionInfoRes.data[0];
  if (!sessionInfo) throw new Error(`Sessione ${sessionKey} non trovata`);

  // Risultati gara
  await sleep(300);
  const resultsRes = await axios.get(`${BASE_URL}/session_result?session_key=${sessionKey}`, { timeout: 15000 });
  const results = resultsRes.data;
  if (!results.length) throw new Error(`Nessun risultato per session_key ${sessionKey}`);

  // Piloti della sessione
  await sleep(300);
  const driversRes = await axios.get(`${BASE_URL}/drivers?session_key=${sessionKey}`, { timeout: 15000 });
  const driversMap = {};
  for (const d of driversRes.data) driversMap[d.driver_number] = d;

  // Pole position dalle qualifiche
  let poleDriverNumber = null;
  try {
    await sleep(300);
    const qualSessionsRes = await axios.get(
      `${BASE_URL}/sessions?meeting_key=${sessionInfo.meeting_key}&session_name=Qualifying`,
      { timeout: 15000 }
    );
    const qualSession = qualSessionsRes.data[0];
    if (qualSession) {
      await sleep(300);
      const qualResultsRes = await axios.get(`${BASE_URL}/session_result?session_key=${qualSession.session_key}`, { timeout: 15000 });
      const pole = qualResultsRes.data.find(r => r.position === 1);
      poleDriverNumber = pole?.driver_number || null;
    }
  } catch (e) { console.warn('Qualifying non disponibile:', e.message); }

  const season = await get('SELECT id FROM seasons WHERE year=$1', [year]);
  const race = await get('SELECT id FROM races WHERE season_id=$1 AND jolpica_round=$2', [season.id, sessionKey]);
  if (!race) throw new Error(`Gara con session_key ${sessionKey} non trovata nel DB. Risincronizza il calendario.`);

  await run('DELETE FROM race_results WHERE race_id=$1', [race.id]);

  for (const r of results) {
    const jolpicaId = String(r.driver_number);
    const driver = await get('SELECT id FROM drivers WHERE season_id=$1 AND jolpica_id=$2', [season.id, jolpicaId]);
    if (!driver) continue;

    const dnf = r.dnf || r.dns || r.dsq || false;
    const isPole = r.driver_number === poleDriverNumber;

    await run(
      'INSERT INTO race_results (race_id,driver_id,position,is_dnf,is_pole,caused_incident) VALUES ($1,$2,$3,$4,$5,0)',
      [race.id, driver.id, dnf ? null : r.position, dnf ? 1 : 0, isPole ? 1 : 0]
    );
  }

  await run("UPDATE races SET status='completed' WHERE id=$1", [race.id]);
  return results.length;
}

async function fetchPreviousYearResults(currentYear = 2026) {
  const prev = currentYear - 1;
  const sessionsRes = await axios.get(`${BASE_URL}/sessions?year=${prev}&session_type=Race`, { timeout: 15000 });
  const sessions = sessionsRes.data;

  await run('DELETE FROM previous_year_results');

  for (const session of sessions) {
    await sleep(500);
    try {
      const [resultsRes, driversRes] = await Promise.all([
        axios.get(`${BASE_URL}/session_result?session_key=${session.session_key}`, { timeout: 15000 }),
        axios.get(`${BASE_URL}/drivers?session_key=${session.session_key}`, { timeout: 15000 })
      ]);

      const driversMap = {};
      for (const d of driversRes.data) driversMap[d.driver_number] = d;

      for (const r of resultsRes.data) {
        const driver = driversMap[r.driver_number];
        if (!driver) continue;
        const dnf = r.dnf || r.dns || r.dsq || false;
        await run(
          'INSERT INTO previous_year_results (race_name, driver_code, position, is_dnf) VALUES ($1,$2,$3,$4)',
          [session.country_name, driver.name_acronym, dnf ? null : r.position, dnf ? 1 : 0]
        );
      }
    } catch (e) { console.warn(`Skip sessione ${session.session_key}: ${e.message}`); }
  }
}

async function updateRaceStatuses() {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await run("UPDATE races SET status='open' WHERE status='upcoming' AND deadline>$1 AND date>$1", [now]);
  await run("UPDATE races SET status='closed' WHERE status='open' AND deadline<=$1", [now]);
}

module.exports = { fetchCalendar, fetchDrivers, fetchRaceResults, fetchPreviousYearResults, updateRaceStatuses };
