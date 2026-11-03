// Engine exit contract (W09-01, OD-07). Reads only structured files of the out dir, never log text:
//   completed       exit 0 or 2, meta.json finalized, findings-and-scores.json present and
//                   report-health.json state validated_outputs|complete|incomplete
//   infra_failed    our timeout, or the engine recorded a lost sandbox / provider outage
//   operator_error  the engine could not be started (missing or non-executable ./bin/audit)
//   engine_error    anything else (retried once, then settled as infra_failed)
//   aborted         the worker stopped the run (shutdown, or the request was refunded meanwhile)
import fs from 'node:fs';
import path from 'node:path';
import type { EngineRunResult } from '../engine/port.ts';

export type Outcome =
  | { kind: 'completed'; incomplete: boolean }
  | { kind: 'infra_failed'; cause: string }
  | { kind: 'engine_error'; cause: string }
  | { kind: 'operator_error'; cause: string }
  | { kind: 'aborted' };

const COMPLETE_STATES = new Set(['validated_outputs', 'complete']);
const INFRA_STAGE = /^(sandbox_unavailable|sandbox_or_orchestrator|docker_unavailable|provider_unavailable)/;
const INFRA_PROVIDER = new Set(['sandbox_unavailable', 'mcp_unavailable', 'transport_lost', 'usage_limit', 'provider_error', 'timeout', 'control_timeout']);

export function readJson(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function infraCause(meta: Record<string, unknown> | null): string | null {
  const stages = Array.isArray(meta?.stageFailures) ? meta.stageFailures.filter((s): s is string => typeof s === 'string') : [];
  const stage = stages.find((s) => INFRA_STAGE.test(s));
  if (stage) return stage.split(':')[0] === 'sandbox_or_orchestrator' ? 'sandbox_failed' : stage.split(':')[0] ?? stage;
  const providers = meta?.providerFailures && typeof meta.providerFailures === 'object' ? Object.values(meta.providerFailures) : [];
  const provider = providers.find((reason): reason is string => typeof reason === 'string' && INFRA_PROVIDER.has(reason));
  return provider ? 'provider_unavailable' : null;
}

export function classify(result: EngineRunResult, outDir: string): Outcome {
  if (result.aborted) return { kind: 'aborted' };
  if (result.spawnError) return { kind: 'operator_error', cause: `spawn_${result.spawnError.toLowerCase()}` };
  if (result.timedOut) return { kind: 'infra_failed', cause: 'timeout' };
  const meta = readJson(path.join(outDir, 'meta.json'));
  const health = readJson(path.join(outDir, 'report-health.json'));
  const state = String(health?.state ?? '').toLowerCase();
  const finished = (result.exitCode === 0 || result.exitCode === 2) && meta?.finalized === true;
  if (finished && fs.existsSync(path.join(outDir, 'findings-and-scores.json')) && (COMPLETE_STATES.has(state) || state === 'incomplete')) {
    return { kind: 'completed', incomplete: state === 'incomplete' || result.exitCode === 2 };
  }
  const infra = infraCause(meta);
  if (infra) return { kind: 'infra_failed', cause: infra };
  return { kind: 'engine_error', cause: result.signal ? `signal_${result.signal}` : `exit_${result.exitCode}` };
}
