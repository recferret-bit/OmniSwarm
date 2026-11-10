'use strict';

module.exports = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://tipjar:tipjar@db:5432/tipjar',
  jwtSecret: process.env.JWT_SECRET || 'tipjar-dev-secret',
  adminApiKey: process.env.ADMIN_API_KEY || '',
  nearNetwork: process.env.NEAR_NETWORK || 'mainnet',
  payoutAccount: process.env.PAYOUT_ACCOUNT || 'payouts.tipjar.near',
  payoutKey: process.env.PAYOUT_PRIVATE_KEY || 'ed25519:4444444444444444444444444444444444444444444444444444',
  contractId: process.env.CONTRACT_ID || 'tipjar.near',
};
