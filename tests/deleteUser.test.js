const request = require('supertest');
const app = require('../src/service');

// tiny helpers
const PWD = 'toomanysecrets';
const rand = () => Math.random().toString(36).slice(2, 10);
const emailFor = (label) => `${label}-${rand()}@jwt.com`;

// auth agent with Authorization header
function authAgent(token) {
  const agent = request(app);
  const withAuth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    get:  (path) => withAuth(agent.get(path)),
    del:  (path) => withAuth(agent.delete(path)),
  };
}

jest.setTimeout(20000);

describe('DELETE /api/user/:id', () => {
  let adminToken;

  beforeAll(async () => {
    // login as the seeded admin from DB init
    const adminLogin = await request(app).put('/api/auth').send({
      email: 'a@jwt.com',
      password: 'admin',
    });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.token;
  });

  test('requires auth (401)', async () => {
    // make someone to delete
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
    // make a normal user and log them in
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

    // make a victim
    const victimReg = await request(app).post('/api/auth').send({
      name: 'Victim ' + rand(),
      email: emailFor('victim'),
      password: PWD,
    });
    const victim = victimReg.body.user;

    // attempt delete as non-admin
    const res = await authAgent(userLogin.body.token).del(`/api/user/${victim.id}`);
    expect(res.status).toBe(403); // your deleteUser sends 403 with {message:'forbidden'}
  });

  test('admin can delete (204) and user no longer appears in list', async () => {
    const admin = authAgent(adminToken);

    // register a victim
    const victimReg = await request(app).post('/api/auth').send({
      name: 'ToDelete ' + rand(),
      email: emailFor('todelete'),
      password: PWD,
    });
    const victim = victimReg.body.user;

    // delete as admin
    const delRes = await admin.del(`/api/user/${victim.id}`);
    expect(delRes.status).toBe(204);

    // verify not present anymore: GET /api/user returns an array (admin-only)
    const listRes = await admin.get('/api/user');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.some(u => u.id === victim.id)).toBe(false);
  });
});
