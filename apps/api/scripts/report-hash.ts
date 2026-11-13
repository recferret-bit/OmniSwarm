// Recompute a published report's hash (W09-11): anyone can run this on a downloaded folder.
//   node apps/api/scripts/report-hash.ts <report-dir>
import { hashReportDir } from '../src/worker/report.ts';

const dir = process.argv[2];
if (!dir) {
  process.stderr.write('usage: report-hash.ts <report-dir>\n');
  process.exit(2);
}
process.stdout.write(`${hashReportDir(dir)}\n`);
