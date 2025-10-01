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

test('Diner can place an order (happy OR factory-fail path)', async () => {
  // Create an admin (to set things up) and a diner (to place order)
  const adminSeed = await createUser({ roles: [{ role: Role.Admin }] });
  const dinerSeed = await createUser();

  // Log them both in
  const adminLogin = await login(adminSeed.email, adminSeed.password);
  const dinerLogin = await login(dinerSeed.email, dinerSeed.password);
  expectOk(adminLogin);
  expectOk(dinerLogin);

  const admin = authAgent(adminLogin.body.token);
  const diner = authAgent(dinerLogin.body.token);

  // Make sure there is at least one menu item
  let menuRes = await request(app).get('/api/order/menu');
  expectOk(menuRes);
  if (menuRes.body.length === 0) {
    const addRes = await admin.put('/api/order/menu').send({
      title: `Menu-${Date.now()}`,
      description: 'temp item',
      image: 'pizzaZ.png',
      price: 0.001,
    });
    expectOk(addRes);

    menuRes = await request(app).get('/api/order/menu');
    expectOk(menuRes);
  }
  const menuItem = menuRes.body[0];
  expect(menuItem).toEqual(expect.objectContaining({
    id: expect.any(Number),
    title: expect.any(String),
    price: expect.any(Number),
  }));

// Create a franchise (admin-only)
  const fr = await admin.post('/api/franchise').send({
    name: `Fr-${Date.now()}`,
    admins: [{ email: 'a@jwt.com' }], // <-- known existing admin user
  });
  expectOk(fr);
  const franchiseId = fr.body.id;
  expect(franchiseId).toBeGreaterThan(0);

  // Create a store inside that franchise (admin-only)
  const st = await admin.post(`/api/franchise/${franchiseId}/store`).send({
    franchiseId,
    name: `Store-${Date.now()}`,
  });
  expectOk(st);
  const storeId = st.body.id;
  expect(storeId).toBeGreaterThan(0);

  // Now the diner places an order for that store + menu item
  const orderReq = {
    franchiseId,
    storeId,
    items: [
      {
        menuId: menuItem.id,
        description: menuItem.title,
        price: menuItem.price,
      },
    ],
  };

  const orderRes = await diner.post('/api/order').send(orderReq);

  if (orderRes.status === 200) {
    // Success case: order accepted, should return order info + jwt
    expect(orderRes.body).toEqual(
      expect.objectContaining({
        order: expect.objectContaining({
          franchiseId,
          storeId,
          items: expect.any(Array),
        }),
        jwt: expect.any(String),
      })
    );
  } else {
    // Failure case: factory rejected it, should return 500 + error message
    expect(orderRes.status).toBe(500);
    expect(orderRes.body).toMatchObject({
      message: 'Failed to fulfill order at factory',
    });
    expect(orderRes.body).toHaveProperty('followLinkToEndChaos');
  }
});
