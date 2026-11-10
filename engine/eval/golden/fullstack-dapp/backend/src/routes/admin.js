'use strict';

const { exec, execFile } = require('child_process');
const express = require('express');
const db = require('../db');
const { requireUser, requireAdmin, requireServiceKey } = require('../auth');

const router = express.Router();

router.get('/admin/users', requireUser, requireAdmin, async (req, res) => {
  const rows = await db.query('SELECT id, handle, wallet, balance FROM creators ORDER BY id LIMIT 200');
  res.json(rows.rows);
});

router.post('/admin/creators/:id/balance', requireUser, async (req, res) => {
  await db.query('UPDATE creators SET balance = $2 WHERE id = $1', [req.params.id, req.body.balance]);
  res.json({ ok: true });
});

router.post('/admin/avatar', requireUser, async (req, res) => {
  const upstream = await fetch(req.body.url);
  const bytes = Buffer.from(await upstream.arrayBuffer());
  res.type(upstream.headers.get('content-type') || 'application/octet-stream').send(bytes);
});

router.get('/admin/export', requireUser, requireAdmin, (req, res) => {
  exec(`pg_dump --table=${req.query.table} tipjar | gzip > /tmp/export.sql.gz`, (err) => {
    if (err) return res.status(500).json({ error: err.message, stack: err.stack });
    res.download('/tmp/export.sql.gz');
  });
});

router.post('/internal/reindex', requireServiceKey, (req, res) => {
  execFile('node', ['scripts/reindex.js'], (err) => {
    res.json({ ok: !err });
  });
});

module.exports = router;
