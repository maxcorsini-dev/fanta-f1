jest.mock('../database', () => ({ query: jest.fn(), get: jest.fn(), run: jest.fn() }));
jest.mock('../mailer', () => ({ sendWelcome: jest.fn() }));
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn()
}));

const request = require('supertest');
const express = require('express');
const { get, run } = require('../database');
const { sendWelcome } = require('../mailer');
const bcrypt = require('bcryptjs');

// App minimale per i test (senza DB session)
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.session = {}; next(); });
app.use('/api/auth', require('../routes/auth'));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/auth/register', () => {
  test('registrazione valida → successo + welcome email', async () => {
    get.mockResolvedValueOnce(null); // nessun utente esistente
    run.mockResolvedValue(undefined);
    get.mockResolvedValueOnce({ id: 1 }); // utente creato (RETURNING id)

    const res = await request(app).post('/api/auth/register').send({
      username: 'mario',
      email: 'mario@test.it',
      password: 'password123',
      confirm_password: 'password123'
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.redirect).toBe('/dashboard.html');
    expect(sendWelcome).toHaveBeenCalledWith('mario@test.it', 'mario');
  });

  test('campi mancanti → errore', async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: 'mario',
      email: 'mario@test.it'
    });
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/obbligatori/i);
  });

  test('password non coincidono → errore', async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: 'mario',
      email: 'mario@test.it',
      password: 'password123',
      confirm_password: 'diversa'
    });
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/non coincidono/i);
  });

  test('password troppo corta → errore', async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: 'mario',
      email: 'mario@test.it',
      password: '123',
      confirm_password: '123'
    });
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/corta/i);
  });

  test('username o email già in uso → errore', async () => {
    get.mockResolvedValueOnce({ id: 99 }); // utente già esistente
    const res = await request(app).post('/api/auth/register').send({
      username: 'mario',
      email: 'mario@test.it',
      password: 'password123',
      confirm_password: 'password123'
    });
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/già in uso/i);
  });
});

describe('POST /api/auth/login', () => {
  test('credenziali corrette → successo', async () => {
    get.mockResolvedValueOnce({ id: 1, username: 'mario', password: 'hashed', is_admin: 0 });
    bcrypt.compare.mockResolvedValueOnce(true);

    const res = await request(app).post('/api/auth/login').send({
      username: 'mario',
      password: 'password123'
    });

    expect(res.body.success).toBe(true);
    expect(res.body.redirect).toBe('/dashboard.html');
  });

  test('admin → redirect a admin.html', async () => {
    get.mockResolvedValueOnce({ id: 1, username: 'admin', password: 'hashed', is_admin: 1 });
    bcrypt.compare.mockResolvedValueOnce(true);

    const res = await request(app).post('/api/auth/login').send({
      username: 'admin',
      password: 'adminpass'
    });

    expect(res.body.success).toBe(true);
    expect(res.body.redirect).toBe('/admin.html');
  });

  test('utente non trovato → errore', async () => {
    get.mockResolvedValueOnce(null);

    const res = await request(app).post('/api/auth/login').send({
      username: 'nessuno',
      password: 'password123'
    });

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Credenziali errate/i);
  });

  test('password errata → errore', async () => {
    get.mockResolvedValueOnce({ id: 1, username: 'mario', password: 'hashed', is_admin: 0 });
    bcrypt.compare.mockResolvedValueOnce(false);

    const res = await request(app).post('/api/auth/login').send({
      username: 'mario',
      password: 'sbagliata'
    });

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Credenziali errate/i);
  });
});

describe('GET /api/auth/me', () => {
  test('non autenticato → logged: false', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.body.logged).toBe(false);
  });
});
