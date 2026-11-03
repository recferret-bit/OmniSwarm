// reviewers/<id>/ for every reviewer (W05). It runs before the report phase writes the final meta, so a failure
// here lands in meta.stageFailures and the run reads INCOMPLETE without hiding the main report.
// generate-html-report.mjs derives again after scoring, so per-reviewer statuses match findings-and-scores.json.
import { deriveReviewerReports } from './reviewer-reports.mjs';

export const phase = {
  name: 'reviewer-reports',
  after: 'general-review',
  optional: true,
  async run(ctx) {
    deriveReviewerReports(ctx.output);
  },
};
