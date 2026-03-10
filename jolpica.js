const axios = require('axios');
const { query, get, run } = require('./database');

const BASE_URL = 'https://api.jolpi.ca/ergast/f1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function isDnf(status, positionText) {
  if (!status) return false;
  if (status === 'Finished') return false;
  if (status.startsWith('+')) return false; // +1 Lap, +2 Laps = doppiati, hanno finito
  // Se positionText è un numero, il pilota è classificato (doppiato o altro)
  if (positionText && !isNaN(parseInt(positionText))) return false;
  return true; // Retired, Accident, Engine, ecc.
}

function getDeadline(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 2);
  d.setHours(23, 59, 0, 0);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

async function fetchCalendar(year = 2026) {
  const res = await axios.get(`${BASE_URL}/${year}.json`, { timeout: 10000 });
  const races = res.data.MRData.RaceTable.Races;
  const season = await get('SELECT id FROM seasons WHERE year=$1', [year]);
  if (!season) throw new Error(`Stagione ${year} non trovata`);
  for (const race of races) {
    const ex = await get('SELECT id FROM races WHERE season_id=$1 AND round=$2', [season.id, parseInt(race.round)]);
    if (!ex) await run(
      `INSERT INTO races (season_id,round,name,circuit,country,date,deadline,jolpica_round,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'upcoming')`,
      [season.id, parseInt(race.round), race.raceName, race.Circuit.circuitName,
       race.Circuit.Location.country, race.date, getDeadline(race.date), parseInt(race.round)]
    );
  }
  return races.length;
}

async function fetchDrivers(year = 2026) {
  const res = await axios.get(`${BASE_URL}/${year}/drivers.json`, { timeout: 10000 });
  const drivers = res.data.MRData.DriverTable.Drivers;
  const season = await get('SELECT id FROM seasons WHERE year=$1', [year]);
  let teamMap = {};
  try {
    const sr = await axios.get(`${BASE_URL}/${year}/driverStandings.json`, { timeout: 10000 });
    for (const s of sr.data.MRData.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [])
      teamMap[s.Driver.driverId] = s.Constructors?.[0]?.name || 'Unknown';
  } catch (e) {}
  for (const d of drivers) {
    const fullName = `${d.givenName} ${d.familyName}`;
    const team = teamMap[d.driverId] || 'Unknown';
    const ex = await get('SELECT id FROM drivers WHERE season_id=$1 AND jolpica_id=$2', [season.id, d.driverId]);
    if (!ex) await run(
      'INSERT INTO drivers (season_id,number,code,full_name,team,jolpica_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [season.id, parseInt(d.permanentNumber) || 0, d.code || d.familyName.substring(0, 3).toUpperCase(), fullName, team, d.driverId]
    );
    else await run('UPDATE drivers SET team=$1, full_name=$2 WHERE id=$3', [team, fullName, ex.id]);
  }
  return drivers.length;
}

async function fetchRaceResults(year, round) {
  const res = await axios.get(`${BASE_URL}/${year}/${round}/results.json`, { timeout: 10000 });
  const raceData = res.data.MRData.RaceTable.Races[0];
  if (!raceData) throw new Error(`Nessun risultato per round ${round}`);

  let poleId = null;
  try {
    await sleep(500);
    const qr = await axios.get(`${BASE_URL}/${year}/${round}/qualifying.json`, { timeout: 10000 });
    poleId = qr.data.MRData.RaceTable.Races[0]?.QualifyingResults?.[0]?.Driver?.driverId || null;
  } catch (e) {}

  const season = await get('SELECT id FROM seasons WHERE year=$1', [year]);
  const race = await get('SELECT id FROM races WHERE season_id=$1 AND jolpica_round=$2', [season.id, round]);
  if (!race) throw new Error(`Gara round ${round} non trovata`);

  await run('DELETE FROM race_results WHERE race_id=$1', [race.id]);

  for (const r of raceData.Results) {
    const driver = await get('SELECT id FROM drivers WHERE season_id=$1 AND jolpica_id=$2', [season.id, r.Driver.driverId]);
    if (!driver) continue;
    const dnf = isDnf(r.status, r.positionText);
    await run(
      'INSERT INTO race_results (race_id,driver_id,position,is_dnf,is_pole,caused_incident) VALUES ($1,$2,$3,$4,$5,0)',
      [race.id, driver.id, dnf ? null : parseInt(r.position), dnf ? 1 : 0, r.Driver.driverId === poleId ? 1 : 0]
    );
  }

  await run("UPDATE races SET status='completed' WHERE id=$1", [race.id]);
  return raceData.Results.length;
}

async function fetchPreviousYearResults(currentYear = 2026) {
  const prev = currentYear - 1;
  const calRes = await axios.get(`${BASE_URL}/${prev}.json`, { timeout: 10000 });
  await run('DELETE FROM previous_year_results');
  for (const race of calRes.data.MRData.RaceTable.Races) {
    await sleep(300);
    try {
      const rr = await axios.get(`${BASE_URL}/${prev}/${race.round}/results.json`, { timeout: 10000 });
      for (const r of rr.data.MRData.RaceTable.Races[0]?.Results || []) {
        const dnf = isDnf(r.status, r.positionText);
        await run(
          'INSERT INTO previous_year_results (race_name,driver_code,position,is_dnf) VALUES ($1,$2,$3,$4)',
          [race.raceName, r.Driver.code, dnf ? null : parseInt(r.position), dnf ? 1 : 0]
        );
      }
    } catch (e) { console.warn(`Skip ${race.raceName}`); }
  }
}

async function updateRaceStatuses() {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  // upcoming → open: siamo entro 2 settimane dalla gara e la deadline non è ancora scaduta
  await run(
    "UPDATE races SET status='open' WHERE status='upcoming' AND deadline > $1",
    [now]
  );
  // open → closed: deadline scaduta (ma non ancora con risultati = completed)
  await run(
    "UPDATE races SET status='closed' WHERE status='open' AND deadline <= $1",
    [now]
  );
}

module.exports = { fetchCalendar, fetchDrivers, fetchRaceResults, fetchPreviousYearResults, updateRaceStatuses };
