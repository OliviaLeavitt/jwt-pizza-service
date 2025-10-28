const request = require('supertest');
const app = require('../src/service');
const { DB, Role } = require('../src/database/database');

const PWD = 'toomanysecrets';
const rand = () => Math.random().toString(36).slice(2, 10);
const emailFor = (label) => `${label}-${rand()}@jwt.com`;

function authAgent(token) {
  const agent = request(app);
  const withAuth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    get: (path) => withAuth(agent.get(path)),
    del: (path) => withAuth(agent.delete(path)),
  };
}

jest.setTimeout(20000);

describe('DELETE /api/user/:id', () => {
  let adminToken;

  test('requires auth (401)', async () => {
    const victimReg = await request(app).post('/api/auth').send({
      name: 'Victim ' + rand(),
      email: emailFor('victim-unauth'),
      password: PWD,
    });
    const victim = victimReg.body.user;

    const res = await request(app).delete(`/api/user/${victim.id}`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  test('non-admin cannot delete (403)', async () => {
    const userReg = await request(app).post('/api/auth').send({
      name: 'User ' + rand(),
      email: emailFor('user'),
      password: PWD,
    });
    const userLogin = await request(app).put('/api/auth').send({
      email: userReg.body.user.email,
      password: PWD,
    });
    expect(userLogin.status).toBe(200);

    const victimReg = await request(app).post('/api/auth').send({
      name: 'Victim ' + rand(),
      email: emailFor('victim'),
      password: PWD,
    });
    const victim = victimReg.body.user;

    const res = await authAgent(userLogin.body.token).del(`/api/user/${victim.id}`);
    expect(res.status).toBe(403); // correct for non-admin
  });

  test('admin can delete (204) and user no longer appears in list', async () => {
    // ✅ mock DB only for admin login
    jest.spyOn(DB, 'getUser').mockResolvedValue({
      id: 9999,
      name: 'Mock Admin',
      email: 'a@jwt.com',
      password: PWD,
      roles: [{ role: Role.Admin }],
    });
    jest.spyOn(DB, 'loginUser').mockResolvedValue();
    jest.spyOn(DB, 'isLoggedIn').mockResolvedValue(true);

    const adminLogin = await request(app).put('/api/auth').send({
      email: 'a@jwt.com',
      password: 'admin',
    });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.token;

    // register a victim
    const victimReg = await request(app).post('/api/auth').send({
      name: 'ToDelete ' + rand(),
      email: emailFor('todelete'),
      password: PWD,
    });
    const victim = victimReg.body.user;

    // delete as admin
    const admin = authAgent(adminToken);
    const delRes = await admin.del(`/api/user/${victim.id}`);
    expect(delRes.status).toBe(204);

    // verify victim is gone
    const listRes = await admin.get('/api/user');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.some((u) => u.id === victim.id)).toBe(false);

    // cleanup mocks
    jest.restoreAllMocks();
  });
});
