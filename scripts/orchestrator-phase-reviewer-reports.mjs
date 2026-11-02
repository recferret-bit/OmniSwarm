// Runs after the built-in report phase. A failure is recorded and does not hide the main HTML report.
import { readReportJson, writeReportFile } from './report-contract.mjs';
import { deriveReviewerReports } from './reviewer-reports.mjs';

export const phase = {
  name: 'reviewer-reports',
  after: 'report',
  optional: true,
  async run(ctx) {
    try { await deriveReviewerReports(ctx.output); }
    catch (error) {
      const meta = readReportJson(ctx.output, 'meta.json');
      meta.stageFailures = [...(meta.stageFailures || []), `phase_failed:reviewer-reports:${error.message}`];
      writeReportFile(ctx.output, 'meta.json', `${JSON.stringify(meta, null, 2)}\n`);
      throw error;
    }
  },
};
