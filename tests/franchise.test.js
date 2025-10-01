const request = require('supertest');
const app = require('../src/service');
const { Role, DB } = require('../src/database/database');

// helpers
const PWD = 'toomanysecrets';
const rand = () => Math.random().toString(36).slice(2, 10);
const emailFor = (label) => `${label}-${rand()}@test.com`;

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
  const res = await request(app).put('/api/auth').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token;
}

// wrapper that always sets Authorization header
function authAgent(token) {
  const agent = request(app);
  const withAuth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    get: (path) => withAuth(agent.get(path)),
    post: (path) => withAuth(agent.post(path)),
    del: (path) => withAuth(agent.delete(path)),
  };
}

// quick assertions for status codes
const createFranchise = (agent, payload) => agent.post('/api/franchise').send(payload);
const getUserFranchises = (agent, userId) => agent.get(`/api/franchise/${userId}`);
const createStore = (agent, fid, payload) => agent.post(`/api/franchise/${fid}/store`).send(payload);
const deleteStore = (agent, fid, sid) => agent.del(`/api/franchise/${fid}/store/${sid}`);


const expectOk = (res) => expect(res.status).toBe(200);
const expectForbidden = (res) => {
  expect(res.status).toBe(403);
  expect(res.body).toEqual(expect.objectContaining({ message: expect.any(String) }));
};

// tests
test('admin can create a franchise', async () => {
  // Create an admin user and log in
  const admin = await createUser({ roles: [{ role: Role.Admin }] });
  const adminAgent = authAgent(await login(admin.email));

  // Try creating a franchise as admin
  const res = await createFranchise(adminAgent, {
    name: `Fr-${Date.now()}`,
    admins: [{ email: admin.email }],
  });

  // Should succeed and return a franchise object
  expectOk(res);
  expect(res.body).toEqual(
    expect.objectContaining({ id: expect.any(Number), name: expect.any(String) })
  );
});

test('non-admin cannot create a franchise', async () => {
  // Create a normal user and log in
  const user = await createUser();
  const userAgent = authAgent(await login(user.email));

  // Try creating a franchise as non-admin
  const res = await createFranchise(userAgent, {
    name: `Fr-${Date.now()}`,
    admins: [{ email: user.email }],
  });

  // Should be forbidden
  expectForbidden(res);
});

test("GET /api/franchise/:userId returns user's franchises for self or admin only", async () => {
  // Create admin, Alice, and Bob
  const admin = await createUser({ roles: [{ role: Role.Admin }] });
  const alice = await createUser();
  const bob = await createUser();

  const adminAgent = authAgent(await login(admin.email));
  const aliceAgent = authAgent(await login(alice.email));
  const bobAgent = authAgent(await login(bob.email));

  // Seed a franchise where Alice is an admin
  const seeded = await createFranchise(adminAgent, {
    name: `AliceCo-${rand()}`,
    admins: [{ email: alice.email }],
  });
  expectOk(seeded);
  const frId = seeded.body.id;

  // Alice should see her franchise
  const aliceView = await getUserFranchises(aliceAgent, alice.id);
  expectOk(aliceView);
  expect(aliceView.body.map((f) => f.id)).toContain(frId);

  // Admin should also see Alice’s franchise
  const adminView = await getUserFranchises(adminAgent, alice.id);
  expectOk(adminView);
  expect(adminView.body.map((f) => f.id)).toContain(frId);

  // Bob should not see Alice’s franchise
  const bobView = await getUserFranchises(bobAgent, alice.id);
  expectOk(bobView);
  expect(bobView.body).toEqual([]);
});

test('store creation allowed for global admin and franchise admin; denied otherwise', async () => {
  // Create a global admin, a franchise admin, and a random user
  const globalAdmin = await createUser({ roles: [{ role: Role.Admin }] });
  const franAdmin = await createUser();
  const rando = await createUser();

  const globalAgent = authAgent(await login(globalAdmin.email));
  const franAgent = authAgent(await login(franAdmin.email));
  const randoAgent = authAgent(await login(rando.email));

  // Seed a franchise with franAdmin as admin
  const fr = await createFranchise(globalAgent, {
    name: `Fr-${rand()}`,
    admins: [{ email: franAdmin.email }],
  });
  expectOk(fr);
  const franchiseId = fr.body.id;

  // Global admin can create a store
  const byGlobal = await createStore(globalAgent, franchiseId, { name: 'HQ' });
  expectOk(byGlobal);
  expect(byGlobal.body).toEqual(expect.objectContaining({ id: expect.any(Number), name: 'HQ' }));

  // Global admin can create a store
  const byFran = await createStore(franAgent, franchiseId, { name: 'Branch' });
  expectOk(byFran);
  expect(byFran.body).toEqual(expect.objectContaining({ id: expect.any(Number), name: 'Branch' }));

  // Global admin can create a store
  const byRando = await createStore(randoAgent, franchiseId, { name: 'Nope' });
  expectForbidden(byRando);
});

test('delete store requires global admin or franchise admin', async () => {
  // Create global admin, franchise admin, and stranger
  const admin = await createUser({ roles: [{ role: Role.Admin }] });
  const franAdmin = await createUser();
  const stranger = await createUser();

  const adminAgent = authAgent(await login(admin.email));
  const franAgent = authAgent(await login(franAdmin.email));
  const strangerAgent = authAgent(await login(stranger.email));

  // Seed a franchise with franAdmin as admin and add a store
  const fr = await createFranchise(adminAgent, {
    name: `Fr-${rand()}`,
    admins: [{ email: franAdmin.email }],
  });
  expectOk(fr);
  const franchiseId = fr.body.id;

  const storeRes = await createStore(franAgent, franchiseId, { name: 'SoonGone' });
  expectOk(storeRes);
  const storeId = storeRes.body.id;

  // Stranger should not be able to delete the store
  const denied = await deleteStore(strangerAgent, franchiseId, storeId);
  expectForbidden(denied);

  // Franchise admin should be able to delete the store
  const ok = await deleteStore(franAgent, franchiseId, storeId);
  expectOk(ok);
  expect(ok.body).toEqual({ message: 'store deleted' });
});
