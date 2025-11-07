const express = require('express');
const { asyncHandler } = require('../endpointHelper.js');
const { DB, Role } = require('../database/database.js');
const { authRouter, setAuth } = require('./authRouter.js');
const metrics = require('../metricsGenerator.js');

const userRouter = express.Router();

userRouter.docs = [
  {
    method: 'GET',
    path: '/api/user?page=1&limit=10&name=*',
    requiresAuth: true,
    description: 'Gets a paginated list of users (admin only). Wildcard name filter uses *.',
    example: `curl -X GET "localhost:3000/api/user?page=1&limit=10&name=*bob*" -H 'Authorization: Bearer tttttt'`,
    response: { users: [{ id: 3, name: 'Kai Chen', email: 'd@jwt.com', roles: [{ role: 'diner' }] }], more: true },
  },
  {
    method: 'DELETE',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Deletes a user (admin only)',
    example: `curl -X DELETE localhost:3000/api/user/3 -H 'Authorization: Bearer tttttt'`,
    response: {},
  },
  {
    method: 'GET',
    path: '/api/user/me',
    requiresAuth: true,
    description: 'Get authenticated user',
    example: `curl -X GET localhost:3000/api/user/me -H 'Authorization: Bearer tttttt'`,
    response: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] },
  },
  {
    method: 'PUT',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Update user',
    example: `curl -X PUT localhost:3000/api/user/1 -d '{"name":"常用名字", "email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt'`,
    response: { user: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] }, token: 'tttttt' },
  },
];

// listUsers
userRouter.get(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      res.status(403).json({ message: 'forbidden' });
      // safe metrics call after sending response
      try { metrics.userList(false); } catch {}
      return;
    }
    const users = await DB.getUsers(req.user);
    res.json(users);
    try { metrics.userList(true); } catch {}
  })
);

// deleteUser
userRouter.delete(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      res.status(403).json({ message: 'forbidden' });
      try { metrics.userDelete(false); } catch {}
      return;
    }

    const userId = Number(req.params.userId);
    const deleted = await DB.deleteUser(userId);
    if (!deleted) {
      res.status(404).json({ message: 'not found' });
      try { metrics.userDelete(false); } catch {}
      return;
    }

    res.status(204).send();
    try { metrics.userDelete(true); } catch {}
  })
);

// getUser (authenticated)
userRouter.get(
  '/me',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json(req.user);
    try { metrics.userFetch(true); } catch {}
  })
);

// updateUser
userRouter.put(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const userId = Number(req.params.userId);
    const user = req.user;
    if (user.id !== userId && !user.isRole(Role.Admin)) {
      res.status(403).json({ message: 'unauthorized' });
      try { metrics.userUpdate(false); } catch {}
      return;
    }

    const updatedUser = await DB.updateUser(userId, name, email, password);
    const auth = await setAuth(updatedUser);

    res.json({ user: updatedUser, token: auth });
    try { metrics.userUpdate(true); } catch {}
  })
);

module.exports = userRouter;
