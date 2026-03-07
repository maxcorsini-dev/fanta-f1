const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Wrapper semplice: query(sql, params)
async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

async function get(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0] || null;
}

async function run(sql, params = []) {
  await pool.query(sql, params);
}

async function initDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
      total_score INTEGER DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS seasons (
      id SERIAL PRIMARY KEY,
      year INTEGER UNIQUE NOT NULL,
      is_active INTEGER DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS races (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL,
      round INTEGER NOT NULL,
      name TEXT NOT NULL,
      circuit TEXT NOT NULL,
      country TEXT NOT NULL,
      date TEXT NOT NULL,
      deadline TEXT NOT NULL,
      status TEXT DEFAULT 'upcoming',
      jolpica_round INTEGER
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS drivers (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      code TEXT NOT NULL,
      full_name TEXT NOT NULL,
      team TEXT NOT NULL,
      jolpica_id TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS race_results (
      id SERIAL PRIMARY KEY,
      race_id INTEGER NOT NULL,
      driver_id INTEGER NOT NULL,
      position INTEGER,
      is_dnf INTEGER DEFAULT 0,
      is_pole INTEGER DEFAULT 0,
      caused_incident INTEGER DEFAULT 0,
      UNIQUE(race_id, driver_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS previous_year_results (
      id SERIAL PRIMARY KEY,
      race_name TEXT NOT NULL,
      driver_code TEXT NOT NULL,
      position INTEGER,
      is_dnf INTEGER DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS predictions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      race_id INTEGER NOT NULL,
      driver_id INTEGER NOT NULL,
      predicted_position INTEGER,
      is_dnf_prediction INTEGER DEFAULT 0,
      is_pole_prediction INTEGER DEFAULT 0,
      submitted_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
      UNIQUE(user_id, race_id, driver_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS scores (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      race_id INTEGER NOT NULL,
      base_score INTEGER DEFAULT 200,
      position_points INTEGER DEFAULT 0,
      dnf_points INTEGER DEFAULT 0,
      bonus_points INTEGER DEFAULT 0,
      malus_points INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      breakdown TEXT,
      calculated_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
      UNIQUE(user_id, race_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      race_id INTEGER NOT NULL,
      paypal_order_id TEXT UNIQUE,
      paypal_capture_id TEXT,
      amount REAL DEFAULT 1.00,
      currency TEXT DEFAULT 'EUR',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
      completed_at TEXT
    )
  `);

  // Tabella sessioni per connect-pg-simple
  await run(`
    CREATE TABLE IF NOT EXISTS session (
      sid TEXT NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS IDX_session_expire ON session(expire)`);

  const season = await get('SELECT id FROM seasons WHERE year = 2026');
  if (!season) {
    await run('INSERT INTO seasons (year, is_active) VALUES (2026, 1)');
    console.log('✅ Stagione 2026 creata');
  }

  console.log('✅ Database PostgreSQL inizializzato');
}

module.exports = { query, get, run, initDatabase, pool };
