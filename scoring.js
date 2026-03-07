const { query, get, run } = require('./database');

async function calculateScores(raceId) {
  const race = await get('SELECT * FROM races WHERE id = $1', [raceId]);
  if (!race) throw new Error('Gara non trovata');

  const officialResults = await query(`
    SELECT rr.*, d.id as driver_id, d.full_name, d.team FROM race_results rr
    JOIN drivers d ON d.id = rr.driver_id WHERE rr.race_id = $1`, [raceId]);
  if (!officialResults.length) throw new Error('Nessun risultato ufficiale');

  const officialByDriver = {}, officialByPosition = {};
  let lastPos = 0, poleDriver = null;
  for (const r of officialResults) {
    officialByDriver[r.driver_id] = r;
    if (!r.is_dnf && r.position) { officialByPosition[r.position] = r; if (r.position > lastPos) lastPos = r.position; }
    if (r.is_pole) poleDriver = r;
  }

  const realPodium = [1,2,3].map(p => officialByPosition[p]?.driver_id).filter(Boolean);
  const ferrariPodium = realPodium.some(id => officialByDriver[id]?.team === 'Ferrari');
  const usersRaw = await query('SELECT DISTINCT user_id FROM predictions WHERE race_id = $1', [raceId]);
  const results = [];

  for (const { user_id: userId } of usersRaw) {
    const preds = await query(`SELECT p.*, d.team, d.full_name FROM predictions p
      JOIN drivers d ON d.id = p.driver_id WHERE p.user_id=$1 AND p.race_id=$2`, [userId, raceId]);

    let posPoints=0, dnfPoints=0, bonusPoints=0, malusPoints=0;
    const breakdown=[], predByPos={};
    for (const p of preds) if (!p.is_dnf_prediction && p.predicted_position) predByPos[p.predicted_position] = p;

    let allWrong=true, correctPos=0;
    for (const pred of preds) {
      const off = officialByDriver[pred.driver_id];
      if (!off) continue;
      if (pred.is_dnf_prediction) {
        if (off.is_dnf) { dnfPoints+=5; allWrong=false; breakdown.push(`✅ DNF corretto: ${pred.full_name} (+5)`); }
      } else {
        if (!off.is_dnf && off.position===pred.predicted_position) {
          posPoints+=10; correctPos++; allWrong=false; breakdown.push(`✅ P${pred.predicted_position} corretta: ${pred.full_name} (+10)`);
        } else if (!off.is_dnf && off.position) {
          const diff = Math.abs(off.position - pred.predicted_position); posPoints-=diff;
          breakdown.push(`📍 ${pred.full_name}: P${pred.predicted_position}→P${off.position} (-${diff})`);
        } else if (off.is_dnf) {
          const diff = Math.abs((lastPos+1) - pred.predicted_position); posPoints-=diff;
          breakdown.push(`❌ ${pred.full_name}: P${pred.predicted_position} ma DNF (-${diff})`);
        }
      }
    }

    if (poleDriver) {
      const pp = preds.find(p => p.is_pole_prediction && p.driver_id===poleDriver.driver_id);
      if (pp) { bonusPoints+=10; breakdown.push(`🏆 Pole corretta (+10)`); }
    }
    const predPodium = [1,2,3].map(p => predByPos[p]?.driver_id).filter(Boolean);
    const podiumOk = realPodium.every(id => predPodium.includes(id)) && predPodium.length===3;
    if (podiumOk) { bonusPoints+=30; breakdown.push(`🏆 Podio corretto (+30)`); }
    if (podiumOk && ferrariPodium) { bonusPoints+=50; breakdown.push(`🔴 Podio Ferrari (+50)`); }
    const lastPred = preds.find(p => !p.is_dnf_prediction && p.predicted_position===lastPos);
    if (lastPred && officialByPosition[lastPos]?.driver_id===lastPred.driver_id) { bonusPoints+=20; breakdown.push(`🔚 Ultima posizione (+20)`); }
    const teams = [...new Set(preds.map(p => p.team))];
    for (const team of teams) {
      const tp = preds.filter(p => p.team===team && !p.is_dnf_prediction);
      if (tp.length===2) {
        const [p1,p2]=tp; const o1=officialByDriver[p1.driver_id], o2=officialByDriver[p2.driver_id];
        if (o1&&o2&&!o1.is_dnf&&!o2.is_dnf&&o1.position===p1.predicted_position&&o2.position===p2.predicted_position) { bonusPoints+=20; breakdown.push(`👥 Coppia ${team} (+20)`); }
      }
    }
    if (allWrong && preds.length>0) { malusPoints-=20; breakdown.push(`💀 Tutto sbagliato (-20)`); }
    if (predByPos[1]?.driver_id===officialByPosition[1]?.driver_id && correctPos===1) { malusPoints-=10; breakdown.push(`⚠️ Solo 1° corretto (-10)`); }
    for (const id of predPodium) if (officialByDriver[id]?.is_dnf) { malusPoints-=20; breakdown.push(`💥 Podio DNF: ${officialByDriver[id].full_name} (-20)`); }
    for (const p of preds) if (p.is_dnf_prediction && officialByDriver[p.driver_id]?.caused_incident) { malusPoints-=10; breakdown.push(`🚨 DNF incidente (-10)`); }
    if (poleDriver?.is_dnf && preds.find(p => p.is_pole_prediction && p.driver_id===poleDriver.driver_id)) { malusPoints-=30; breakdown.push(`💀 Pole DNF (-30)`); }

    const total = posPoints + dnfPoints + bonusPoints + malusPoints;
    await run('DELETE FROM scores WHERE user_id=$1 AND race_id=$2', [userId, raceId]);
    await run(`INSERT INTO scores (user_id,race_id,base_score,position_points,dnf_points,bonus_points,malus_points,total,breakdown)
      VALUES ($1,$2,200,$3,$4,$5,$6,$7,$8)`, [userId, raceId, posPoints, dnfPoints, bonusPoints, malusPoints, total, JSON.stringify(breakdown)]);
    results.push({ userId, total });
  }

  // Aggiorna totali stagionali
  await run(`UPDATE users SET total_score = COALESCE((SELECT SUM(base_score+total) FROM scores WHERE user_id=users.id), 0)`);
  return results;
}

module.exports = { calculateScores };
