// Rail link to reviewers.html. The page itself and the per-reviewer pages are written by reviewer-reports.mjs
// with the same shell (report-cards-shell.mjs), from meta.reviewers and the committed submissions.
export const section = {
  id: 'reviewers-index',
  order: 70,
  rail: { num: '', label: 'Reviewers', page: 'reviewers.html' },
  pages: ['reviewers'],
};
