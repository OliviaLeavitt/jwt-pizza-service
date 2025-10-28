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
jest.setTimeout(20000);

test('Get menu lists pizzas', async () => {
    // Ask the server for the menu
  const res = await request(app).get('/api/order/menu');

  // Should get a 200 and an array back
  expectOk(res);
  expect(Array.isArray(res.body)).toBe(true);

  // If there are pizzas, check the shape of the first one
  if (res.body.length) {
    expect(res.body[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        title: expect.any(String),
        image: expect.any(String),
        price: expect.any(Number),
        description: expect.any(String),
      })
    );
  }
});

test('Admin can add a menu item; diner cannot', async () => {
  // Make an admin user and a normal user
  const adminSeed = await createUser({ roles: [{ role: Role.Admin }] });
  const dinerSeed = await createUser();

  // Log them both in
  const adminLogin = await login(adminSeed.email, adminSeed.password);
  expectOk(adminLogin);
  const dinerLogin = await login(dinerSeed.email, dinerSeed.password);
  expectOk(dinerLogin);

  const admin = authAgent(adminLogin.body.token);
  const diner = authAgent(dinerLogin.body.token);

  // Normal diner tries to add an item -> should fail
  const dinerPut = await diner.put('/api/order/menu').send({
    title: `Student-${Date.now()}`,
    description: 'carbs only',
    image: 'pizza9.png',
    price: 0.0001,
  });
  expect(dinerPut.status).toBe(403);
  expect(dinerPut.body).toMatchObject({ message: expect.any(String) });

  // Admin tries to add an item -> should succeed
  const title = `Special-${Date.now()}`;
  const adminPut = await admin.put('/api/order/menu').send({
    title,
    description: 'chef special',
    image: 'pizzaX.png',
    price: 0.0042,
  });
  expectOk(adminPut);

  // The new item should appear in the menu list
  expect(Array.isArray(adminPut.body)).toBe(true);
  expect(adminPut.body.some((m) => m.title === title)).toBe(true);
});

test('Orders requires auth (401) and returns orders for diner (200)', async () => {
  // Try without a token -> should get 401 unauthorized
  const noAuth = await request(app).get('/api/order');
  expectUnauthorized(noAuth);

  // Create and log in a diner
  const dinerSeed = await createUser();
  const dinerLogin = await login(dinerSeed.email, dinerSeed.password);
  expectOk(dinerLogin);

  // With a token -> should get 200 and an orders array
  const diner = authAgent(dinerLogin.body.token);
  const getOrders = await diner.get('/api/order');
  expectOk(getOrders);
  expect(getOrders.body).toEqual(
    expect.objectContaining({
      orders: expect.any(Array),
    })
  );
});
