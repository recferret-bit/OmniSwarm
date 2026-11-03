// OmniSwarm's own fixtures: the bundled demo and the golden eval repos. The scripted judge (the citation
// rules standing in for a model) runs only on these; run-config refuses it at plan time elsewhere and
// debate-plan refuses it again when the debate starts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
export const FIXTURE_ROOTS = Object.freeze([path.join(ROOT, 'scripts', 'demo-fixture'), path.join(ROOT, 'eval', 'golden')]);

export function isFixtureTarget(target) {
  if (!target) return false;
  const real = fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target);
  return FIXTURE_ROOTS.some((root) => real === root || real.startsWith(`${root}${path.sep}`));
}

export const SCRIPTED_JUDGE_REFUSAL = 'scripted_judge_demo_only';
