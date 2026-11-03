import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** apps/api */
export const APP_ROOT = path.resolve(HERE, '../..');
/** The repository root, where ./bin/audit lives. */
export const REPO_ROOT = path.resolve(APP_ROOT, '../..');
