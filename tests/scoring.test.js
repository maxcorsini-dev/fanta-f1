jest.mock('../database', () => ({
  query: jest.fn(),
  get: jest.fn(),
  run: jest.fn()
}));

const { query, get, run } = require('../database');
const { calculateScores } = require('../scoring');

// Dati base riutilizzati nei test
const RACE = { id: 1, name: 'GP Australia' };
const USER = { user_id: 1 };

// Piloti: Ferrari (1,3), Mercedes (2)
function makeDriver(id, team) { return { driver_id: id, id, full_name: `Pilota${id}`, team }; }

function makeResult(driverId, position, { is_dnf = 0, is_pole = 0, caused_incident = 0, team = 'Ferrari' } = {}) {
  return { driver_id: driverId, id: driverId, full_name: `Pilota${driverId}`, team, position, is_dnf, is_pole, caused_incident };
}

function makePred(driverId, position, { is_dnf_prediction = 0, is_pole_prediction = 0, team = 'Ferrari' } = {}) {
  return { driver_id: driverId, predicted_position: position, is_dnf_prediction, is_pole_prediction, full_name: `Pilota${driverId}`, team };
}

function setupMocks(results, predictions) {
  get.mockReset();
  query.mockReset();
  run.mockReset();
  run.mockResolvedValue(undefined);

  get.mockResolvedValueOnce(RACE); // get race
  query.mockResolvedValueOnce(results); // official results
  query.mockResolvedValueOnce([USER]); // distinct users
  query.mockResolvedValueOnce(predictions); // predictions for user
  run.mockResolvedValue(undefined);
}

async function getInsertedScore() {
  const insertCall = run.mock.calls.find(c => c[0].includes('INSERT INTO scores'));
  // params: [userId, raceId, posPoints, dnfPoints, bonusPoints, malusPoints, total, breakdown]
  return {
    posPoints: insertCall[1][2],
    dnfPoints: insertCall[1][3],
    bonusPoints: insertCall[1][4],
    malusPoints: insertCall[1][5],
    total: insertCall[1][6],
    breakdown: JSON.parse(insertCall[1][7])
  };
}

describe('calculateScores — posizioni', () => {
  test('posizione corretta → +10', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, 2, { team: 'Mercedes' }), makeResult(3, 3, { team: 'Ferrari' })],
      [makePred(1, 1, { team: 'Ferrari' })]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.posPoints).toBe(10);
  });

  test('posizione sbagliata di 2 → -2', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, 3, { team: 'Mercedes' })],
      [makePred(2, 1, { team: 'Mercedes' })]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.posPoints).toBe(-2);
  });

  test('pilota previsto classificato finisce DNF → penalità distanza da ultima posizione', async () => {
    // lastPos = 2 (driver1@P1, driver2@P2 classificati), driver3 DNF
    // pred P1 per driver3 che fa DNF → diff = |(2+1) - 1| = 2 → -2
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, 2, { team: 'Ferrari' }), makeResult(3, null, { is_dnf: 1, team: 'Mercedes' })],
      [makePred(3, 1, { team: 'Mercedes' })]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.posPoints).toBe(-2);
  });
});

describe('calculateScores — DNF', () => {
  test('DNF previsto e confermato → +5', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, null, { is_dnf: 1, team: 'Mercedes' })],
      [makePred(2, null, { is_dnf_prediction: 1, team: 'Mercedes' })]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.dnfPoints).toBe(5);
  });

  test('DNF previsto ma pilota classificato → 0 punti DNF', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, 2, { team: 'Mercedes' })],
      [makePred(2, null, { is_dnf_prediction: 1, team: 'Mercedes' })]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.dnfPoints).toBe(0);
  });
});

describe('calculateScores — bonus', () => {
  test('pole corretta → +10 bonus', async () => {
    setupMocks(
      [makeResult(1, 1, { is_pole: 1, team: 'Ferrari' }), makeResult(2, 2, { team: 'Mercedes' }), makeResult(3, 3, { team: 'Ferrari' })],
      [makePred(1, 1, { is_pole_prediction: 1, team: 'Ferrari' })]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.bonusPoints).toBeGreaterThanOrEqual(10);
    expect(s.breakdown.some(b => b.includes('Pole corretta'))).toBe(true);
  });

  test('podio completo corretto → +30 bonus', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Mercedes' }), makeResult(2, 2, { team: 'Mercedes' }), makeResult(3, 3, { team: 'Ferrari' })],
      [
        makePred(1, 1, { team: 'Mercedes' }),
        makePred(2, 2, { team: 'Mercedes' }),
        makePred(3, 3, { team: 'Ferrari' })
      ]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.breakdown.some(b => b.includes('Podio corretto'))).toBe(true);
    expect(s.bonusPoints).toBeGreaterThanOrEqual(30);
  });

  test('podio con Ferrari → +30 podio +50 Ferrari', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, 2, { team: 'Mercedes' }), makeResult(3, 3, { team: 'Ferrari' })],
      [
        makePred(1, 1, { team: 'Ferrari' }),
        makePred(2, 2, { team: 'Mercedes' }),
        makePred(3, 3, { team: 'Ferrari' })
      ]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.breakdown.some(b => b.includes('Podio Ferrari'))).toBe(true);
    expect(s.bonusPoints).toBeGreaterThanOrEqual(80);
  });

  test('coppia stesso team entrambe corrette → +20', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, 2, { team: 'Ferrari' }), makeResult(3, 3, { team: 'Mercedes' })],
      [
        makePred(1, 1, { team: 'Ferrari' }),
        makePred(2, 2, { team: 'Ferrari' })
      ]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.breakdown.some(b => b.includes('Coppia Ferrari'))).toBe(true);
  });

  test('ultima posizione corretta → +20', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, 2, { team: 'Mercedes' }), makeResult(3, 3, { team: 'Ferrari' })],
      [makePred(3, 3, { team: 'Ferrari' })]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.breakdown.some(b => b.includes('Ultima posizione'))).toBe(true);
  });
});

describe('calculateScores — malus', () => {
  test('tutto sbagliato → -20 malus', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, 2, { team: 'Mercedes' })],
      [
        makePred(1, 2, { team: 'Ferrari' }),  // sbagliato
        makePred(2, 1, { team: 'Mercedes' })  // sbagliato
      ]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.malusPoints).toBeLessThanOrEqual(-20);
    expect(s.breakdown.some(b => b.includes('Tutto sbagliato'))).toBe(true);
  });

  test('solo 1° corretto → -10 malus', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, 2, { team: 'Mercedes' }), makeResult(3, 3, { team: 'Ferrari' })],
      [
        makePred(1, 1, { team: 'Ferrari' }),  // corretto
        makePred(2, 3, { team: 'Mercedes' }), // sbagliato
        makePred(3, 2, { team: 'Ferrari' })   // sbagliato
      ]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.breakdown.some(b => b.includes('Solo 1°'))).toBe(true);
    expect(s.malusPoints).toBeLessThanOrEqual(-10);
  });

  test('pilota previsto in podio finisce DNF → -20 malus per ogni podio DNF', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, null, { is_dnf: 1, team: 'Mercedes' }), makeResult(3, 2, { team: 'Ferrari' })],
      [
        makePred(1, 1, { team: 'Ferrari' }),
        makePred(2, 2, { team: 'Mercedes' }), // previsto in podio, fa DNF
        makePred(3, 3, { team: 'Ferrari' })
      ]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.breakdown.some(b => b.includes('Podio DNF'))).toBe(true);
    expect(s.malusPoints).toBeLessThanOrEqual(-20);
  });

  test('pole prevista correttamente ma pole fa DNF → -30 malus', async () => {
    setupMocks(
      [makeResult(1, null, { is_dnf: 1, is_pole: 1, team: 'Ferrari' }), makeResult(2, 1, { team: 'Mercedes' })],
      [makePred(1, null, { is_dnf_prediction: 1, is_pole_prediction: 1, team: 'Ferrari' })]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.breakdown.some(b => b.includes('Pole DNF'))).toBe(true);
    expect(s.malusPoints).toBeLessThanOrEqual(-30);
  });

  test('DNF causato da incidente: malus -10', async () => {
    setupMocks(
      [makeResult(1, 1, { team: 'Ferrari' }), makeResult(2, null, { is_dnf: 1, caused_incident: 1, team: 'Mercedes' })],
      [makePred(2, null, { is_dnf_prediction: 1, team: 'Mercedes' })]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    expect(s.breakdown.some(b => b.includes('DNF incidente'))).toBe(true);
    expect(s.malusPoints).toBeLessThanOrEqual(-10);
  });
});

describe('calculateScores — totale', () => {
  test('pronostici perfetti (3 piloti) → punteggio positivo alto', async () => {
    setupMocks(
      [
        makeResult(1, 1, { is_pole: 1, team: 'Ferrari' }),
        makeResult(2, 2, { team: 'Mercedes' }),
        makeResult(3, 3, { team: 'Ferrari' })
      ],
      [
        makePred(1, 1, { is_pole_prediction: 1, team: 'Ferrari' }),
        makePred(2, 2, { team: 'Mercedes' }),
        makePred(3, 3, { team: 'Ferrari' })
      ]
    );
    await calculateScores(1);
    const s = await getInsertedScore();
    // posPoints=30, bonus=10(pole)+30(podio)+50(Ferrari)+20(lastPos)+20(coppia Ferrari)=130, malus=0
    expect(s.total).toBe(160);
  });

  test('nessuna prediction → nessun punteggio inserito', async () => {
    get.mockReset(); query.mockReset(); run.mockReset();
    get.mockResolvedValueOnce(RACE);
    query.mockResolvedValueOnce([makeResult(1, 1, { team: 'Ferrari' })]);
    query.mockResolvedValueOnce([]); // nessun utente
    run.mockResolvedValue(undefined);

    const results = await calculateScores(1);
    expect(results).toHaveLength(0);
    expect(run).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO scores'), expect.anything());
  });
});
