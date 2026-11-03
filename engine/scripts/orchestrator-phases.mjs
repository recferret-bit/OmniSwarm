// Phase registry for the orchestrator. ORCHESTRATION section 2, PRODUCT_WAVES section 4.
//   prepare -> tests -> review -> crosscheck -> debate -> adjudicate -> general-review -> report
// A phase is {name, after, run(ctx), optional?, always?}. The orchestrator supplies the built-in
// implementations (prepare, tests, review, crosscheck, report). debate, adjudicate and general-review are
// no-op stubs here. A later wave replaces a stub, or adds a new phase, by dropping
// scripts/orchestrator-phase-<name>.mjs next to this file; that file exports `phase`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PHASE_NAMES = Object.freeze(['prepare', 'tests', 'review', 'crosscheck', 'debate', 'adjudicate', 'general-review', 'report']);
export const STUBS = Object.freeze(['debate', 'adjudicate', 'general-review']);
const PHASE_FILE = /^orchestrator-phase-([a-z][a-z0-9-]*)\.mjs$/;
const NAME = /^[a-z][a-z0-9-]*$/;

// builtin: {prepare, tests, review, crosscheck, report} -> run functions. dir: where phase files live.
export async function loadPhases({ builtin, dir = HERE } = {}) {
  const phases = new Map();
  PHASE_NAMES.forEach((name, index) => {
    const run = builtin?.[name];
    if (!run && !STUBS.includes(name)) throw new Error(`orchestrator phase "${name}" has no implementation`);
    phases.set(name, { name, after: PHASE_NAMES[index - 1] || null, run: run || (async () => {}), optional: STUBS.includes(name), always: name === 'report', stub: !run });
  });
  const files = fs.readdirSync(dir).filter((f) => PHASE_FILE.test(f)).sort();
  for (const file of files) {
    const name = PHASE_FILE.exec(file)[1];
    const { phase } = await import(path.join(dir, file));
    if (!phase || phase.name !== name || typeof phase.run !== 'function') throw new Error(`${file} must export phase = {name: "${name}", run(ctx)}`);
    if (phases.has(name)) {
      if (!phases.get(name).stub) throw new Error(`${file} cannot replace the built-in phase "${name}"`);
      phases.set(name, { ...phases.get(name), ...phase, stub: false, always: false });
    } else {
      if (!NAME.test(name) || !phase.after || !phases.has(phase.after)) throw new Error(`${file}: "after" must name an existing phase`);
      phases.set(name, { optional: true, ...phase, always: false });
    }
  }
  return order(phases);
}

// Insert extra phases right after their `after` phase (several extras after one phase keep file order).
function order(phases) {
  const list = PHASE_NAMES.map((n) => phases.get(n));
  for (const phase of phases.values()) {
    if (PHASE_NAMES.includes(phase.name)) continue;
    let at = list.findIndex((p) => p.name === phase.after);
    while (list[at + 1] && !PHASE_NAMES.includes(list[at + 1].name) && list[at + 1].after === phase.after) at += 1;
    list.splice(at + 1, 0, phase);
  }
  return list;
}

// Run phases in order. A failed required phase records the failure through ctx.fail(error) and skips every
// later phase except `always` ones. ctx.teardown() runs once, before the first `always` phase, or at the end.
export async function runPhases(phases, ctx) {
  let failed = false;
  let tornDown = false;
  const teardown = async () => { if (!tornDown) { tornDown = true; await ctx.teardown?.(); } };
  try {
    for (const phase of phases) {
      if (phase.always) await teardown();
      if (failed && !phase.always) continue;
      try { await phase.run(ctx); }
      catch (error) {
        if (phase.optional) ctx.stageFailures?.push(`phase_failed:${phase.name}:${error.message}`);
        else { failed = true; ctx.fail?.(error, phase); }
      }
    }
  } finally { await teardown(); }
  return { failed };
}
