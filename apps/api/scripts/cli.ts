// Shared plumbing of the dev scripts: strict flag parsing and a refusal to touch a production setup.
import { parseArgs, type ParseArgsConfig } from 'node:util';

export function flags<T extends NonNullable<ParseArgsConfig['options']>>(options: T, usage: string) {
  try {
    return parseArgs({ options, allowPositionals: true, strict: true });
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\nusage: ${usage}\n`);
    process.exit(2);
  }
}

export function devOnly(script: string): void {
  if (process.env.NODE_ENV === 'production') {
    process.stderr.write(`${script} is a development script and refuses NODE_ENV=production\n`);
    process.exit(2);
  }
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(2);
  }
  return url;
}
