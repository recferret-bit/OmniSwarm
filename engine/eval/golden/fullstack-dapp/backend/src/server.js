'use strict';

const express = require('express');
const cors = require('cors');
const config = require('./config');
const auth = require('./auth');

const app = express();

app.set('trust proxy', true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/auth/nonce', auth.issueNonce);
app.post('/auth/login', auth.login);
app.use('/api', require('./routes/tips'));
app.use('/api', require('./routes/admin'));

app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message, stack: err.stack, env: process.env });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`tipjar api on ${config.port}`);
});
