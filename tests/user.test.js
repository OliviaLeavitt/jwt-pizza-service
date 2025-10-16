const request = require('supertest');
const app = require('../src/service');

// ---------- helpers ----------
const PWD = 'toomanysecrets';
const rand = () => Math.random().toString(36).slice(2, 10);
const emailFor = (label) => `${label}-${rand()}@jwt.com`;

async function login(email, password = PWD) {
  return request(app).put('/api/auth').send({ email, password });
}

function authAgent(token) {
  const agent = request(app);
  const withAuth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    get: (path) => withAuth(agent.get(path)),
    post: (path) => withAuth(agent.post(path)),
    put: (path) => withAuth(agent.put(path)),
    del: (path) => withAuth(agent.delete(path)),
  };
}

const expectOk = (res) => expect(res.status).toBe(200);
const expectUnauthorized = (res) => {
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ message: 'unauthorized' });
};

jest.setTimeout(20000);

// ---------- tests ----------

// GET /api/user/me requires auth
test('GET /api/user/me returns 401 without token', async () => {
  const res = await request(app).get('/api/user/me');
  expectUnauthorized(res);
});

// GET /api/user requires auth
test('GET /api/user returns 401 without token', async () => {
  const res = await request(app).get('/api/user');
  expectUnauthorized(res);
});

// GET /api/user returns 403 for non-admin with token
test('GET /api/user returns 403 for non-admin', async () => {
  const reg = await request(app).post('/api/auth').send({
    name: 'user-' + rand(),
    email: emailFor('user'),
    password: PWD,
  });

  const res = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + reg.body.token);

  expect(res.status).toBe(403);
});

// GET /api/user/me returns the logged-in user
test('GET /api/user/me returns the logged-in user', async () => {
  const name = 'user-' + rand();
  const email = emailFor('me');

  const reg = await request(app).post('/api/auth').send({
    name,
    email,
    password: PWD,
  });
  const user = reg.body.user;

  const loginRes = await login(email, PWD);
  expectOk(loginRes);

  const me = await authAgent(loginRes.body.token).get('/api/user/me');
  expectOk(me);
  expect(me.body).toEqual(
    expect.objectContaining({
      id: user.id,
      name,
      email,
      roles: expect.any(Array),
    })
  );
});

// PUT /api/user/:id lets a user update themself and returns a NEW token
test('PUT /api/user/:id lets a user update themself and returns a NEW token', async () => {
  const reg = await request(app).post('/api/auth').send({
    name: 'self-' + rand(),
    email: emailFor('self'),
    password: PWD,
  });
  const user = reg.body.user;

  const loginRes = await login(user.email, PWD);
  expectOk(loginRes);
  const oldToken = loginRes.body.token;

  const newName = `updated-${rand()}`;
  const newEmail = emailFor('updated');

  const updateRes = await authAgent(oldToken)
    .put(`/api/user/${user.id}`)
    .send({ name: newName, email: newEmail, password: PWD });

  expectOk(updateRes);
  expect(typeof updateRes.body.token).toBe('string');
  expect(updateRes.body.token).not.toBe(oldToken);

  const meAfter = await authAgent(updateRes.body.token).get('/api/user/me');
  expectOk(meAfter);
  expect(meAfter.body).toEqual(
    expect.objectContaining({ id: user.id, name: newName, email: newEmail })
  );
});

// PUT /api/user/:id rejects when another non-admin tries to update you (403)
test('PUT /api/user/:id rejects when another non-admin tries to update you (403)', async () => {
  // victim
  const victimReg = await request(app).post('/api/auth').send({
    name: 'victim-' + rand(),
    email: emailFor('victim'),
    password: PWD,
  });
  const victim = victimReg.body.user;

  // attacker
  const attackerReg = await request(app).post('/api/auth').send({
    name: 'attacker-' + rand(),
    email: emailFor('attacker'),
    password: PWD,
  });
  const attackerLogin = await login(attackerReg.body.user.email, PWD);
  expectOk(attackerLogin);

  const res = await authAgent(attackerLogin.body.token)
    .put(`/api/user/${victim.id}`)
    .send({ name: 'hax', email: emailFor('hax'), password: PWD });

  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ message: 'unauthorized' });
});

test('GET /api/user returns list for admin', async () => {
  // login as seeded admin
  const adminLogin = await login('a@jwt.com', 'admin');
  expectOk(adminLogin);

  // create a couple diners so there’s data
  await request(app).post('/api/auth').send({
    name: 'user1-' + rand(),
    email: emailFor('u1'),
    password: PWD,
  });
  await request(app).post('/api/auth').send({
    name: 'user2-' + rand(),
    email: emailFor('u2'),
    password: PWD,
  });

  // call as admin
  const res = await authAgent(adminLogin.body.token).get('/api/user');
  expectOk(res);
  expect(res.body.length).toBeGreaterThan(0);
});

// PUT /api/user/:id allows an admin to update any user
test('PUT /api/user/:id allows an admin to update any user', async () => {
  // login as seeded admin
  const adminLogin = await login('a@jwt.com', 'admin');
  expectOk(adminLogin);

  // register a diner to be updated
  const targetReg = await request(app).post('/api/auth').send({
    name: 'target-' + rand(),
    email: emailFor('target'),
    password: PWD,
  });
  const target = targetReg.body.user;

  const newName = `admin-updated-${rand()}`;
  const newEmail = emailFor('admin-updated');

  const res = await authAgent(adminLogin.body.token)
    .put(`/api/user/${target.id}`)
    .send({ name: newName, email: newEmail, password: PWD });

  expectOk(res);
  expect(res.body).toEqual(
    expect.objectContaining({
      user: expect.objectContaining({
        id: target.id,
        name: newName,
        email: newEmail,
      }),
      token: expect.any(String),
    })
  );
});