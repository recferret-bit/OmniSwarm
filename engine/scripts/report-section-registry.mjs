// Report v2 section registry. Every engine/scripts/report-section-*.mjs module (tests excluded) that exports
// `section` is discovered here and sorted by `order`; a section is {id, order, pages, slot?, rail?,
// render(data, extra)} and owns its markup:
//   slot 'hero'     renders under the overview hero        slot 'toolbar'  renders in the findings toolbar
//   slot 'evidence' renders after the evidence panels      slot 'card'     renders inside each finding card
//   slot 'page'     returns {rel, body, opts} for a whole page, or null to keep the pre-v2 page
// A run without debate/ or general-review.json gets no v2 at all, so the pre-v2 pages stay byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadV2Data } from './report-section-v2-data.mjs';
import { statusCss, statusPill, FINAL, LEGACY, MEANING, STATUS_COLORS } from './report-section-status-legend.mjs';
import { FAMILY_ORDER } from './report-section-v2-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.basename(fileURLToPath(import.meta.url));
// Section modules sit flat beside this one; their *.test.mjs neighbours must never be imported at runtime.
const SECTION_FILE = /^report-section-[a-z0-9-]+\.mjs$/;

export function loadSections(dir = HERE) {
  return fs.readdirSync(dir).filter((name) => SECTION_FILE.test(name) && !name.endsWith('.test.mjs') && name !== SELF).sort();
}

async function discover(dir = HERE) {
  const found = [];
  for (const name of loadSections(dir)) {
    const mod = await import(pathToFileURL(path.join(dir, name)).href);
    if (mod.section) found.push(mod.section);
  }
  return found.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

const SECTIONS = await discover();
export function sectionDescriptors() { return [...SECTIONS]; }

// Rail links after 04 Evidence: in-page anchors on the report, links back to it elsewhere.
function railLinks(root, here) {
  const report = here === 'report' ? '' : `${root}report.html`;
  return SECTIONS.filter((s) => s.rail && (s.rail.anchor || s.rail.page)).map((s) => {
    const href = s.rail.page ? `${root}${s.rail.page}` : `${report}#${s.rail.anchor}`;
    return `<a href="${href}"><span>${s.rail.num}</span>${s.rail.label}</a>`;
  }).join('');
}

// null for a pre-v2 run; otherwise what generate-html-report.mjs composes into its pages.
export function loadV2(reportDir) {
  const data = loadV2Data(reportDir);
  if (!data) return null;
  const slot = (name, page = 'report', extra) => SECTIONS.filter((s) => s.slot === name && s.pages.includes(page)).map((s) => s.render(data, extra) || '').join('');
  return {
    data,
    slot,
    rail: railLinks,
    pages: () => SECTIONS.filter((s) => s.slot === 'page').map((s) => s.render(data)).filter(Boolean),
    card: { statusPill, debate: (finding) => slot('card', 'report', finding) },
    extraCss: statusCss(),
  };
}

export { STATUS_COLORS };
export const STATUS_LEGEND = { FINAL, LEGACY, MEANING, ORDER: FAMILY_ORDER };
