// `npm run db:migrate -w @omniswarm/api`: the deploy step (the API and workers never migrate).
import { migrateAll } from '../db/deploy.ts';
import { configOrExit } from '../shared/lifecycle.ts';

const applied = await migrateAll(configOrExit('migrate'));
process.stdout.write(`migrated: ${applied.length ? applied.join(', ') : 'up to date'}; queues installed\n`);
