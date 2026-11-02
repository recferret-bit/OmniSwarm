import { createApp } from './app.ts';

const port = Number(process.env.PORT || 8787);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}
const app = await createApp({
  databaseUrl,
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret',
  network: process.env.NETWORK || 'testnet',
  recipient: process.env.INTAKE_RECIPIENT || 'omniswarm.testnet',
  contractId: process.env.CONTRACT_ID || 'review-registry.mock',
  priceYocto: process.env.PRICE_YOCTO,
  maxRepoKb: process.env.MAX_REPO_KB ? Number(process.env.MAX_REPO_KB) : undefined,
  preset: process.env.HOSTED_PRESET || 'scripted',
});
await app.listen({ port, host: '127.0.0.1' });
console.log(`intake listening on ${port}`);
