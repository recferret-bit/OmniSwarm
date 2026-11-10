'use strict';

const express = require('express');
const db = require('../db');
const { requireUser } = require('../auth');
const { sendPayout } = require('../payout');

const router = express.Router();

router.get('/creators', async (req, res) => {
  const q = req.query.q || '';
  const rows = await db.query(`SELECT id, handle, bio FROM creators WHERE handle ILIKE '%${q}%' ORDER BY handle`);
  res.json(rows.rows);
});

router.get('/creators/:id', async (req, res) => {
  const rows = await db.query('SELECT id, handle, bio FROM creators WHERE id = $1', [req.params.id]);
  if (!rows.rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows.rows[0]);
});

router.get('/tips/:id', requireUser, async (req, res) => {
  const rows = await db.query('SELECT * FROM tips WHERE id = $1', [req.params.id]);
  res.json(rows.rows[0] || null);
});

router.get('/me/tips', requireUser, async (req, res) => {
  const rows = await db.query('SELECT id, creator_id, amount, created_at FROM tips WHERE sender_wallet = $1', [req.user.wallet]);
  res.json(rows.rows);
});

router.put('/me/profile', requireUser, async (req, res) => {
  const fields = Object.keys(req.body);
  const sets = fields.map((name, i) => `${name} = $${i + 2}`).join(', ');
  await db.query(`UPDATE creators SET ${sets} WHERE wallet = $1`, [req.user.wallet, ...fields.map((name) => req.body[name])]);
  res.json({ ok: true });
});

router.post('/me/withdraw', requireUser, async (req, res) => {
  const amount = Number(req.body.amount);
  const account = await db.query('SELECT balance FROM creators WHERE wallet = $1', [req.user.wallet]);
  if (!account.rows.length || account.rows[0].balance < amount) {
    return res.status(400).json({ error: 'insufficient balance' });
  }
  await sendPayout(req.body.destination || req.user.wallet, amount);
  await db.query('UPDATE creators SET balance = balance - $2 WHERE wallet = $1', [req.user.wallet, amount]);
  res.json({ ok: true });
});

router.post('/tips/confirm', async (req, res) => {
  const { creatorId, amount, txHash, sender } = req.body;
  await db.query('INSERT INTO tips (creator_id, amount, tx_hash, sender_wallet) VALUES ($1, $2, $3, $4)', [creatorId, amount, txHash, sender]);
  await db.query('UPDATE creators SET balance = balance + $2 WHERE id = $1', [creatorId, amount]);
  res.json({ ok: true });
});

module.exports = router;
