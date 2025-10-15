const request = require('supertest');
const app = require('../src/service');
const { Role, DB } = require('../src/database/database');

// ---------- helpers ----------
const PWD = 'toomanysecrets';
const rand = () => Math.random().toString(36).slice(2, 10);
const emailFor = (label) => `${label}-${rand()}@jwt.com`;

// create an admin directly (fast & deterministic)
async function createAdmin() {
  const admin = await DB.addUser({
    name: `admin-${rand()}`,
    email: emailFor('admin'),
    password: PWD,
    roles: [{ role: Role.Admin }],
  });
  return { ...admin, password: PWD };
}

// register a normal user via PUBLIC API (matches deliverable flow)
async function registerUserViaApi(agent, { name, email, password = PWD }) {
  const res = await agent.post('/api/auth').send({ name, email, password });
  expect(res.status).toBe(200);
  return res.body.user; // {id,name,email,roles}
}

// login helper
async function login(agent, email, password = PWD) {
  return agent.put('/api/auth').send({ email, password });
}

// Authorized agent wrapper (like your example)
function authAgent(token) {
  const agent = request(app);
  const withAuth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    get:  (path) => withAuth(agent.get(path)),
    post: (path) => withAuth(agent.post(path)),
    put:  (path) => withAuth(agent.put(path)),
    del:  (path) => withAuth(agent.delete(path)),
  };
}

jest.setTimeout(20000);

// ---------- tests ----------
describe('User list & delete (GET /api/user, DELETE /api/user/:id)', () => {
  let adminToken;

  beforeAll(async () => {
    const seededAdmin = await createAdmin();
    const loginRes = await login(request(app), seededAdmin.email, PWD);
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  test('GET /api/user returns 401 without Authorization header', async () => {
    const res = await request(app).get('/api/user');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });
  
  test('DELETE /api/user/:id requires auth', async () => {
    const victim = await registerUserViaApi(request(app), {
      name: `Victim ${rand()}`,
      email: emailFor('victim'),
    });
    const res = await request(app).delete(`/api/user/${victim.id}`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  test('DELETE /api/user/:id returns 403 for non-admin', async () => {
    // make a normal user & log in
    const user = await registerUserViaApi(request(app), {
      name: `User ${rand()}`,
      email: emailFor('userA'),
    });
    const userLogin = await login(request(app), user.email, PWD);
    expect(userLogin.status).toBe(200);

    // make a victim
    const victim = await registerUserViaApi(request(app), {
      name: `Victim ${rand()}`,
      email: emailFor('victimB'),
    });

    // try to delete victim with non-admin token
    const res = await authAgent(userLogin.body.token).del(`/api/user/${victim.id}`);
    // your implementation may 401 or 403; both are acceptable for "not allowed"
    expect([401, 403]).toContain(res.status);
  });

  test('DELETE /api/user/:id works for admin (204) and user disappears from filtered results', async () => {
    const me = authAgent(adminToken);

    const victim = await registerUserViaApi(request(app), {
      name: `ToDelete ${rand()}`,
      email: emailFor('todelete'),
    });

    const del = await me.del(`/api/user/${victim.id}`);
    expect(del.status).toBe(204);

    // verify not present anymore by filtering with their full email (most strict)
    const list = await me.get(`/api/user?page=1&limit=50&name=*${encodeURIComponent(victim.email)}*`);
    expect(list.status).toBe(200);
    expect(list.body.users.some((u) => u.id === victim.id)).toBe(false);
  });
});
