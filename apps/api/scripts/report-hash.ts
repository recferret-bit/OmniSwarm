import { hashReportDir } from '../src/worker.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: report-hash.ts <report-dir>');
  process.exit(1);
}
process.stdout.write(`${hashReportDir(dir)}\n`);
