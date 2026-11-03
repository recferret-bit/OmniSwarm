import express, { NextFunction, Request, Response } from 'express';
import { Pool } from 'pg';

const app = express();
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const REDIRECTS = new Set(['/home', '/orders', '/account']);

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.header('x-role') !== 'admin') return res.status(403).end();
  return next();
}

function safeRedirect(target: unknown): string {
  return typeof target === 'string' && REDIRECTS.has(target) ? target : '/home';
}

app.get('/orders/:id', async (req, res) => {
  const result = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  res.json(result.rows[0] ?? null);
});

app.get('/users/search', requireAdmin, async (req, res) => {
  const result = await db.query(`SELECT id, name FROM users WHERE name = '${req.query.name}'`);
  res.json(result.rows);
});

app.post('/users/:id/promote', requireAdmin, async (req, res) => {
  await db.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', req.params.id]);
  res.status(204).end();
});

app.delete('/users/:id', async (req, res) => {
  await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

app.get('/login/done', (req, res) => {
  res.redirect(safeRedirect(req.query.next));
});

export default app;
