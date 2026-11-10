#!/usr/bin/env node
/**
 * audit-plans.mjs
 *
 * Detects the target project's technical stacks and risk domains:
 *   1. HTTP / REST / GraphQL APIs (`http`)
 *   2. gRPC & Protobuf Services (`grpc`)
 *   3. WebSockets & Realtime Streams (`websockets`)
 *   4. Databases, Transactions & Row Locking (`databases`)
 *   5. Cryptography, Web3 & On-Chain Custody (`crypto`)
 *   6. Scopes & Roles Validation / IDOR / Plane Separation (`scopes_roles`)
 *   7. Automation Abuse & Value-Flow Integrity (`abuse_economy`)
 *   8. API Abuse & Response DTO / Error Oracle Leakage (`api_dto_abuse`)
 *
 * Generates structured `stack-profile.json` and `review-plans.md` under `/out/harness`
 * and provides surface-tailored check plans for the MCP bridge and agent orchestrator.
 */

import path from 'node:path';
import { detectEcosystems, isProductionPath } from './stack-detect.mjs';
import { DOMAIN_SPECS, PYTHON_CHECKS, REVIEW_CHECKS } from './audit-plans-data-domains.mjs';
import { EVM_CONTRACT_SURFACE, INFRA_SURFACE, NEAR_CLIENT_SURFACE, NEAR_CONTRACT_SURFACE, NODE_SURFACE, PYTHON_SURFACE, SOLANA_SURFACE, SURFACE_TITLES, WALLET_SURFACE } from './audit-plans-data-surfaces.mjs';
import { LAYERS, LAYER_TITLES, buildLayerMap, renderLayerLines, scopeNote } from './harness-layers.mjs';
import { SKIP_DIRS as WALK_SKIP_DIRS, matchLines, readText, rel as relPath, walk } from './harness-walk.mjs';

// The harness skip list plus reports/, walked in name order so the plan is stable across file systems.
const SKIP_DIRS = new Set([...WALK_SKIP_DIRS, 'reports']);
const MAX_LEADS_PER_RULE = 25;

export { DOMAIN_SPECS, PYTHON_CHECKS };

const CODE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs',
  '.proto', '.sql', '.prisma', '.graphql', '.gql', '.sol', '.rb', '.php', '.java', '.kt',
]);

// The first maxHits matches as {line, snippet}; the snippet is the trimmed source line, at most 140 characters.
function findLineMatches(text, regex, maxHits) {
  const found = matchLines(text, regex, maxHits);
  if (!found.length) return [];
  const lines = text.split('\n');
  return found.map((line) => ({ line, snippet: (lines[line - 1] || '').trim().slice(0, 140) }));
}

export function analyzeStackAndPlans(targetRoot) {
  const root = path.resolve(targetRoot);
  const state = new Map();
  for (const spec of DOMAIN_SPECS) {
    state.set(spec.id, {
      id: spec.id,
      title: spec.title,
      surfaces: spec.surfaces,
      alwaysActive: spec.alwaysActive,
      summary: spec.summary,
      detected: spec.alwaysActive,
      markerHits: [],
      testOnlyHits: 0,
      leads: spec.leads.map((l) => ({ id: l.id, title: l.title, note: l.note, hits: [] })),
      checks: REVIEW_CHECKS[spec.id] || ['Inspect cited source and existing tests; record coverage limits.'],
    });
  }

  let scannedFiles = 0;
  // Application code is read first so lead caps are not consumed by tests, docs and helper scripts,
  // and a domain counts as detected only when production code (not a test or doc) carries its markers.
  const candidates = [];
  walk(root, (file) => {
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file);
    if (!CODE_EXT.has(ext) && base !== 'Anchor.toml' && base !== 'Cargo.toml' && base !== 'package.json') return;
    candidates.push({ file, production: isProductionPath(relPath(root, file)) });
  }, { skipDirs: SKIP_DIRS, sorted: true });
  candidates.sort((a, b) => Number(b.production) - Number(a.production));
  for (const { file, production } of candidates) {
    const text = readText(file);
    if (text == null || text.includes('\0')) continue;

    scannedFiles++;
    const rel = relPath(root, file);

    for (const spec of DOMAIN_SPECS) {
      const dom = state.get(spec.id);
      for (const marker of spec.fileMarkers) {
        const matches = findLineMatches(text, marker.re, 5);
        if (matches.length) {
          if (production) dom.detected = true; else dom.testOnlyHits++;
          for (const hit of matches) {
            if (dom.markerHits.length < 15) {
              dom.markerHits.push(`${rel}:${hit.line} (${marker.label}${production ? '' : ', non-production'})`);
            }
          }
        }
      }
      for (let i = 0; i < spec.leads.length; i++) {
        const rule = spec.leads[i];
        const bucket = dom.leads[i].hits;
        if (bucket.length >= MAX_LEADS_PER_RULE) continue;
        const matches = findLineMatches(text, rule.re, MAX_LEADS_PER_RULE - bucket.length);
        if (matches.length) {
          if (production) dom.detected = true; else dom.testOnlyHits++;
          for (const hit of matches) {
            bucket.push({ citation: `${rel}:${hit.line}`, snippet: hit.snippet, production });
          }
        }
      }
    }
  }

  const domains = [...state.values()].map((d) => ({
    ...d,
    totalLeads: d.leads.reduce((acc, l) => acc + l.hits.length, 0),
  }));

  return {
    scannedFiles,
    ecosystems: detectEcosystems(root),
    layers: buildLayerMap(root),
    detectedStacks: domains.filter((d) => d.detected).map((d) => d.id),
    domains,
  };
}

function renderEcosystemLines(profile) {
  const eco = profile.ecosystems;
  if (!eco) return [];
  const row = (name, e, extra = '') => `- **${name}**: ${e.detected ? 'DETECTED' : 'absent'}${e.sourceFiles != null ? ` (${e.sourceFiles} production source files${e.testFiles ? `, ${e.testFiles} test/script files` : ''})` : ''}${extra}`;
  const py = eco.python;
  const declared = py.declaredVersion ? `; declared Python ${py.declaredVersion.version} (${py.declaredVersion.source})` : '';
  return [
    '## Detected Ecosystems',
    row('Python', py, `${py.frameworks.length ? `; frameworks: ${py.frameworks.join(', ')}` : ''}${declared}`),
    row('Node/TypeScript', eco.node, eco.node.frameworks.length ? `; frameworks: ${eco.node.frameworks.join(', ')}` : ''),
    row('Rust', eco.rust),
    `- **Solana program**: ${eco.solana.detected ? `DETECTED (${eco.solana.marks.slice(0, 4).join(', ')})` : 'absent'}`,
    `- **NEAR**: ${eco.near?.detected ? `DETECTED (${eco.near.contracts ? 'near-sdk contract' : 'no near-sdk crate'}; ${(eco.near.kinds || []).join(', ') || 'no kind'}; ${(eco.near.marks || []).slice(0, 4).join(', ')})` : 'absent'}`,
    `- **EVM**: ${eco.evm?.detected ? `DETECTED (${eco.evm.contracts ? `${eco.evm.sourceFiles} contract file(s)` : 'no contract source'}; ${(eco.evm.kinds || []).join(', ') || 'no kind'}; tooling ${(eco.evm.tooling || []).join(', ') || 'none'})` : 'absent'}`,
    `- Primary stack(s) by production source: ${eco.primary.join(', ') || 'none'}${eco.unsupported?.length ? `; no dedicated harness for: ${eco.unsupported.join(', ')}` : ''}`,
  ];
}

export function renderReviewPlansMarkdown(profile, surfaceFilter = '', scope = '') {
  const filter = String(surfaceFilter || '').toUpperCase();
  const lines = [
    '# Stack Inventory & Source Security Review Plans',
    '',
    `Files scanned: ${profile.scannedFiles} | Active domains: ${profile.detectedStacks.join(', ') || 'none'}`,
    '',
    ...renderEcosystemLines(profile),
    '',
    ...renderLayerLines(profile.layers, scope),
    ...(profile.layers ? [''] : []),
    '## Stack & Risk Domain Matrix',
    '',
    '| Domain ID | Subsystem / Focus | Status | Leads | Primary Surfaces |',
    '|---|---|---|---:|---|',
  ];

  for (const d of profile.domains) {
    lines.push(`| \`${d.id}\` | ${d.title} | **${d.detected ? 'DETECTED' : 'absent'}** | ${d.totalLeads} | ${d.surfaces.join(', ')} |`);
  }
  lines.push('');

  for (const d of profile.domains) {
    if (filter && /^S[1-6]$/.test(filter) && !d.surfaces.includes(filter)) continue;
    lines.push(`## [${d.id.toUpperCase()}] ${d.title} (${d.detected ? 'DETECTED' : 'absent'})`);
    lines.push(`- **Surfaces**: ${d.surfaces.join(', ')}`);
    lines.push(`- **Scope**: ${d.summary}`);
    if (!d.detected) {
      lines.push('- **Status**: No markers or entry points detected in the repository. Confirm absence quickly and record `n/a`.', '');
      continue;
    }
    if (d.markerHits.length) {
      lines.push(`- **Detected Stack Markers**: ${d.markerHits.slice(0, 6).map((m) => `\`${m}\``).join(', ')}`);
    }
    lines.push('', '### Source Review Checks');
    const python = profile.ecosystems?.python?.detected ? PYTHON_CHECKS[d.id] || [] : [];
    for (const [idx, chk] of [...(REVIEW_CHECKS[d.id] || ['Inspect the cited source and existing tests; record evidence and coverage limits.']), ...python].entries()) {
      lines.push(`${idx + 1}. ${chk}`);
    }
    lines.push('', '### Codebase Entry Points & Leads');
    for (const lead of d.leads) {
      lines.push(`#### ${lead.id}: ${lead.title}`);
      lines.push(`_${lead.note}_`);
      if (!lead.hits.length) {
        lines.push('- no direct regex hit (perform manual source trace)');
      } else {
        for (const h of lead.hits.slice(0, 15)) {
          lines.push(`- \`${h.citation}\`${h.production === false ? ' (test/doc)' : ''} — \`${h.snippet.replace(/`/g, "'")}\``);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
}

// With a profile, only the detected ecosystems' guidance is emitted; with none, every stack is included.
// scope: 'web2' | 'web3' | 'infra' shows that layer's block only; anything else shows every present layer.
export function renderSurfaceSkillGuidance(surfaceCode, profile, scope = '') {
  // Cross-check reviewers span every surface (R-06): show the guidance of all six.
  if (String(surfaceCode).toUpperCase() === 'ALL') return ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((code) => renderSurfaceSkillGuidance(code, profile, scope)).join('\n\n');
  const code = /^S[1-6]$/i.test(String(surfaceCode)) ? String(surfaceCode).toUpperCase() : 'S1';
  const eco = profile?.ecosystems;
  const want = (name) => !eco || eco[name]?.detected;
  const nearKinds = new Set(eco?.near?.kinds || []);
  const nearContract = !eco || Boolean(eco?.near?.contracts);
  const nearClient = !eco || ['client', 'intents', 'ai'].some((kind) => nearKinds.has(kind));
  const [title, domains] = SURFACE_TITLES[code];
  const lines = [`### ${code} Skill Focus — ${title} (${domains})`];
  if (eco) lines.push(`Detected stack: ${eco.primary.join(', ') || 'unknown'}${eco.python?.frameworks?.length ? ` (Python frameworks: ${eco.python.frameworks.join(', ')})` : ''}${eco.solana?.detected ? '; Solana program present' : ''}${eco.near?.detected ? `; NEAR (${eco.near.contracts ? 'contract' : 'no contract crate'}${eco.near.kinds?.length ? `: ${eco.near.kinds.join(', ')}` : ''})` : ''}${eco.evm?.detected ? `; EVM (${(eco.evm.kinds || []).join(', ')})` : ''}. Do not apply checks for ecosystems that are absent.`);
  // One block per layer, so application, on-chain and infrastructure checks are never read as one list.
  const layers = profile?.layers;
  const clientFiles = layers?.clientFiles?.length > 0;
  const blocks = {
    web2: [...(want('python') ? PYTHON_SURFACE[code] : []), ...(want('node') ? NODE_SURFACE[code] : [])],
    web3: [
      ...(want('solana') ? SOLANA_SURFACE[code] || [] : []),
      ...(want('near') && nearContract ? NEAR_CONTRACT_SURFACE[code] || [] : []),
      ...(want('near') && nearClient ? NEAR_CLIENT_SURFACE[code] || [] : []),
      ...(!eco || eco.evm?.contracts ? EVM_CONTRACT_SURFACE[code] || [] : []),
      ...(!layers || clientFiles || eco?.solana?.detected || nearClient || eco?.evm?.detected ? WALLET_SURFACE[code] || [] : []),
    ],
    infra: !layers || layers.counts?.infra > 0 ? INFRA_SURFACE[code] || [] : [],
  };
  const only = LAYERS.includes(scope) ? scope : '';
  if (only) lines.push('', scopeNote(only));
  for (const [layer, rows] of Object.entries(blocks)) {
    if (rows.length && (!only || layer === only)) lines.push('', `#### ${LAYER_TITLES[layer]}`, ...rows);
  }
  lines.push(
    '',
    '### Mandatory Cross-Cutting Skill Checks (Apply to Every Surface)',
    '1. **Scopes & Roles Misvalidation (IDOR / RBAC / Plane Separation)**: verify every handler that reads or mutates a resource by ID/wallet checks ownership against the authenticated identity, and that vertical privilege separation (admin vs regular user, guest/demo vs real account) holds.',
    '2. **Automation Abuse & Value-Flow Integrity**: ask whether a script, headless client or set of sybil accounts can break the product\'s rules or drain value (rewards, credits, payouts); verify server-side authoritative checks, replay/uniqueness, deadlines and revocation gates.',
    '3. **API Abuse & Response DTO / Enumeration Oracles**: inspect every response DTO and error message (e.g. "user already registered", distinct status codes); report if an API leaks account/resource existence or raw internal fields.',
  );
  return lines.join('\n');
}
