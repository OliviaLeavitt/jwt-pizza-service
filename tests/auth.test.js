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

// tests
test('Register a new user', async () => {
  const res = await request(app)
    .post('/api/auth')
    .send({ name: 'pizza diner', email: 'd@jwt.com', password: 'pw' });

    // expect a user object with a token
  expectOk(res);
  expect(res.body).toHaveProperty('user');
  expect(res.body.user).toMatchObject({
    name: 'pizza diner',
    email: 'd@jwt.com',
    roles: [{ role: 'diner' }],
  });
  expect(typeof res.body.token).toBe('string');
});

test('Login existing user (admin)', async () => {
  // first seed an admin user directly in DB
  const admin = await createUser({ roles: [{ role: Role.Admin }] });

  // login with that user’s credentials
  const res = await login(admin.email, admin.password);

  // expect the login to return the correct user + token
  expectOk(res);
  expect(res.body).toHaveProperty('user');
  expect(res.body.user).toEqual({
    id: expect.any(Number),
    name: admin.name,
    email: admin.email,
    roles: [{ role: 'admin' }],
  });
  expect(typeof res.body.token).toBe('string');
});

test('Logout a user', async () => {
  // login to get a token
  const user = await createUser();
  const loginRes = await login(user.email, user.password);
  expectOk(loginRes);
  const token = loginRes.body.token;

  // send DELETE /api/auth with the token
  const res = await authAgent(token).del('/api/auth');

  // expect logout success
  expectOk(res);
  expect(res.body).toEqual({ message: 'logout successful' });
});

test('401 when no Authorization header', async () => {
  // call /api/user/me with no token
  const res = await request(app).get('/api/user/me');

  // should return unauthorized
  expectUnauthorized(res);
});

test('Register fails with 400 if required fields are missing', async () => {
  // try registering without email + password
  const res = await request(app).post('/api/auth').send({ name: 'incomplete' });

  // expect a 400 with validation message
  expect(res.status).toBe(400);
  expect(res.body).toEqual({
    message: 'name, email, and password are required',
  });
});

test('Non admin user cannot add to menu', async () => {
  // create and login a normal diner
  const user = await createUser();
  const loginRes = await login(user.email, user.password);
  expectOk(loginRes);
  const diner = authAgent(loginRes.body.token);

  // try to PUT /api/order/menu as diner
  const res = await diner
    .put('/api/order/menu')
    .send({ title: 'Student', description: 'carbs', image: 'pizza9.png', price: 0.0001 });

  // expect forbidden
  expect(res.status).toBe(403);
});

test('Invalid token returns 401 unauthorized', async () => {
  // use a fake JWT
  const res = await request(app)
    .get('/api/user/me')
    .set('Authorization', 'Bearer not-a-jwt');

  // expect unauthorized
  expectUnauthorized(res);
});
