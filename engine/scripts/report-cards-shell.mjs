// The page shell every report page shares: rail, topbar, CSP with a fresh random nonce per render, styles and
// the browser script. generate-html-report.mjs and reviewer-reports.mjs both build pages through it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cspPolicy, esc, newNonce, pageDocument } from './report-cards.mjs';
import { browserScript } from './report-cards-browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function dateLabelOf(meta) {
  const date = meta.date ? new Date(meta.date) : new Date();
  return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString().slice(0, 10);
}

// meta: the run's meta.json. v2: loadV2(reportDir) or null. findingsTotal: scored cluster count for the rail.
export function reportShell({ meta, targetName, expected, findingsTotal, v2 = null }) {
  const nonce = newNonce();
  const dateLabel = dateLabelOf(meta);
  const styles = fs.readFileSync(path.join(HERE, 'report-style.css'), 'utf8');
  const script = browserScript();
  const rail = (modelPage, root, here) => {
    const home = `${root}report.html`;
    const away = modelPage || here !== 'report' ? home : '';
    return `<aside class="rail"><a href="${home}" class="brand"><span class="emblem" aria-hidden="true"></span><span>OmniSwarm<small>SOURCE SECURITY REVIEW</small></span></a>
    <div class="rail-label">Report navigation</div><nav aria-label="Report">
    <a href="${home}" ${!modelPage && here === 'report' ? 'class="active" aria-current="page"' : ''}><span>01</span>Overview</a>
    <a href="${away}#findings"><span>02</span>Findings <small>${findingsTotal}</small></a>
    <a href="${root}findings-by-model.html" ${here === 'model' ? 'class="active" aria-current="page"' : ''}><span>03</span>By model</a>
    <a href="${away}#evidence"><span>04</span>${v2 ? 'Evidence' : 'Evidence & scope'}</a>${v2 ? v2.rail(root, here) : ''}</nav>
    <div class="rail-bottom"><span class="signal"></span>SAVED REVIEW<br>${esc(dateLabel)}<br>REF / ${esc(meta.commit || 'not recorded')}</div></aside>`;
  };
  // here: 'report' | 'model' | 'reviewers' | 'reviewer'. Pages without findings get no script.
  const page = (body, { modelPage = false, root = '', here = modelPage ? 'model' : 'report', legacyStyle = !v2 } = {}) => pageDocument({
    body, modelPage, policy: cspPolicy(nonce), targetName, styles, railHtml: rail(modelPage, root, here), meta, nonce,
    browserScript: modelPage ? '' : script, dateLabel, expected, extraCss: v2?.extraCss || '', styleNonce: !legacyStyle,
  });
  return { nonce, dateLabel, page };
}
