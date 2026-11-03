// `npm run reconcile -w @omniswarm/api`: one reconciler pass now (workers also run it every minute).
import { createCore } from '../src/container.ts';
import { reconcilePayments } from '../src/modules/payments/reconcile.service.ts';
import { createBoss } from '../src/queue/boss.ts';
import { configOrExit } from '../src/shared/lifecycle.ts';

const config = configOrExit('script');
const core = await createCore(config);
const boss = createBoss(config, 'sender');
await boss.start();
try {
  const result = await reconcilePayments({ ...core, boss });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await boss.stop({ graceful: false, close: true });
  await core.pool.end();
}
