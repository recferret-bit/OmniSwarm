// RESULTS.md is committed, so it must be deterministic: the same numbers give the same bytes. The header names
// the date and commit at which the current numbers were first measured; a rerun with unchanged numbers keeps the
// file as it is. Every run's own provenance goes to eval/runs/ (gitignored).
import fs from 'node:fs';
import path from 'node:path';

const HEADER = /^Command: `npm run eval:golden` · date (\S+) · commit (\S+)\n/m;

export function renderResults(body, { date, commit }) {
  return `# Golden eval\n\nCommand: \`npm run eval:golden\` · date ${date} · commit ${commit}\n\n${body}`;
}

// The part of RESULTS.md that the numbers decide, without the date and commit line.
export function resultsBody(text) {
  const match = HEADER.exec(text);
  if (!match || !text.startsWith('# Golden eval\n\n')) return null;
  return text.slice(match.index + match[0].length).replace(/^\n/, '');
}

// Writes RESULTS.md only when the body changed, and always records this run under runsDir.
export function writeResults({ file, runsDir, body, date, commit }) {
  let current = null;
  try { current = fs.readFileSync(file, 'utf8'); } catch { /* first run */ }
  const changed = current === null || resultsBody(current) !== body;
  if (changed) fs.writeFileSync(file, renderResults(body, { date, commit }));
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, 'last-run.json'), `${JSON.stringify({ date, commit, resultsChanged: changed }, null, 2)}\n`);
  return { changed };
}
