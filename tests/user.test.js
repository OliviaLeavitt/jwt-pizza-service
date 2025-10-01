const request = require('supertest');
const app = require('../src/service');
const { Role, DB } = require('../src/database/database');

// helpers
const PWD = 'toomanysecrets';
const rand = () => Math.random().toString(36).slice(2, 10);
const emailFor = (label) => `${label}-${rand()}@jwt.com`;

// create a user directly in DB
async function createUser({ roles = [] } = {}) {
  const user = await DB.addUser({
    name: `u-${rand()}`,
    email: emailFor(roles.length ? 'admin' : 'user'),
    password: PWD,
    roles,
  });
  return { ...user, password: PWD };
}

// login via auth endpoint
async function login(email, password = PWD) {
  return request(app).put('/api/auth').send({ email, password });
}

// wrapper that always sets Authorization header
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

// quick assertions for status codes
const expectOk = (res) => expect(res.status).toBe(200);
const expectUnauthorized = (res) => {
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ message: 'unauthorized' });
};

jest.setTimeout(20000);

// tests
test('GET /api/user/me returns 401 without token', async () => {
    // Try to get current user info without logging in
    // Should return unauthorized
  const res = await request(app).get('/api/user/me');
  expectUnauthorized(res);
});

test('GET /api/user/me returns the logged-in user', async () => {
    // Create a user and log in
  const seed = await createUser(); 
  const loginRes = await login(seed.email, seed.password);
  expectOk(loginRes);

  // Call /me with the user’s token
  // Should return that user’s info
  const me = await authAgent(loginRes.body.token).get('/api/user/me');
  expectOk(me);
  expect(me.body).toEqual(
    expect.objectContaining({
      id: seed.id,
      name: seed.name,
      email: seed.email,
      roles: expect.any(Array),
    })
  );
});

test('PUT /api/user/:id lets a user update themself and returns a NEW token', async () => {
  // Log in as a user
  const seed = await createUser();
  const loginRes = await login(seed.email, seed.password);
  expectOk(loginRes);
  const oldToken = loginRes.body.token;
  const me = authAgent(oldToken);

  // Update own name/email/password
  const newName = `updated-${rand()}`;
  const newEmail = emailFor('updated');
  const updateRes = await me
    .put(`/api/user/${seed.id}`)
    .send({ name: newName, email: newEmail, password: PWD });

  // Should succeed and return updated user + new token
  expectOk(updateRes);
  expect(updateRes.body).toEqual(
    expect.objectContaining({
      user: expect.objectContaining({
        id: seed.id,
        name: newName,
        email: newEmail,
        roles: expect.any(Array),
      }),
      token: expect.any(String),
    })
  );

  // token should change because setAuth() is called after update
  const newToken = updateRes.body.token;
  expect(typeof newToken).toBe('string');
  expect(newToken).not.toBe(oldToken);

  // the new token should auth future calls
  const meAfter = await authAgent(newToken).get('/api/user/me');
  expectOk(meAfter);
  expect(meAfter.body).toEqual(
    expect.objectContaining({ id: seed.id, name: newName, email: newEmail })
  );
});

test('PUT /api/user/:id rejects when another non-admin tries to update you (403)', async () => {
  // Make two normal users
  const victim = await createUser();
  const attacker = await createUser();
  const attackerLogin = await login(attacker.email, attacker.password);
  expectOk(attackerLogin);

  // Attacker tries to update victim’s info
  // Should fail with 403 unauthorized
  const res = await authAgent(attackerLogin.body.token)
    .put(`/api/user/${victim.id}`)
    .send({ name: 'hax', email: emailFor('hax'), password: PWD });

  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ message: 'unauthorized' });
});

test('PUT /api/user/:id allows an admin to update any user', async () => {
  // Make an admin and a normal user
  const adminSeed = await createUser({ roles: [{ role: Role.Admin }] });
  const userSeed = await createUser();
  const adminLogin = await login(adminSeed.email, adminSeed.password);
  expectOk(adminLogin);

  // Admin updates the normal user
  const newName = `admin-updated-${rand()}`;
  const newEmail = emailFor('admin-updated');
  const res = await authAgent(adminLogin.body.token)
    .put(`/api/user/${userSeed.id}`)
    .send({ name: newName, email: newEmail, password: PWD });

  // Should succeed and return updated user + token
  expectOk(res);
  expect(res.body).toEqual(
    expect.objectContaining({
      user: expect.objectContaining({
        id: userSeed.id,
        name: newName,
        email: newEmail,
      }),
      token: expect.any(String),
    })
  );
});
