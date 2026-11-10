'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const config = require('./config');

const nonces = new Map();

function issueNonce(req, res) {
  const wallet = String(req.query.wallet || '');
  const nonce = Math.random().toString(36).slice(2);
  nonces.set(wallet, nonce);
  res.json({ nonce, message: `Sign in to TipJar: ${nonce}` });
}

function login(req, res) {
  const { wallet, publicKey, message, signature } = req.body;
  const expected = nonces.get(wallet);
  if (!expected || !String(message).includes(expected)) {
    return res.status(401).json({ error: 'invalid challenge' });
  }
  const ok = nacl.sign.detached.verify(
    Buffer.from(message, 'utf8'),
    bs58.decode(signature),
    bs58.decode(publicKey),
  );
  if (!ok) return res.status(401).json({ error: 'invalid signature' });
  const token = jwt.sign({ wallet, role: req.body.role || 'user' }, config.jwtSecret);
  res.json({ token });
}

function requireUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer /, '');
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch (err) {
    res.status(401).json({ error: 'unauthorized' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).json({ error: 'forbidden' });
}

function requireServiceKey(req, res, next) {
  const given = Buffer.from(String(req.headers['x-service-key'] || ''));
  const wanted = Buffer.from(config.adminApiKey);
  if (wanted.length === 0 || given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

module.exports = { issueNonce, login, requireUser, requireAdmin, requireServiceKey };
