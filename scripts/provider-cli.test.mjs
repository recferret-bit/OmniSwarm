import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLI_PROVIDERS, family } from './provider-cli.mjs';

test('cli provider metadata names presence rows, transports and the --max-turns CLI', () => {
  assert.equal(family.providers, CLI_PROVIDERS);
  assert.deepEqual(Object.keys(CLI_PROVIDERS).filter((name) => CLI_PROVIDERS[name].presence), ['claude', 'codex', 'grok', 'agy']);
  assert.deepEqual(Object.fromEntries(Object.entries(CLI_PROVIDERS).map(([name, p]) => [name, p.transport])), {
    claude: 'maintained_acp', codex: 'maintained_acp', grok: 'native_acp', agy: 'native_cli_acp_adapter', 'claude-zai': 'maintained_acp',
  });
  assert.deepEqual(Object.keys(CLI_PROVIDERS).filter((name) => CLI_PROVIDERS[name].maxTurnsFlag), ['grok']);
});

test('a launch reports the transport from the provider table', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-bin-'));
  fs.writeFileSync(path.join(bin, 'grok'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-work-'));
  fs.chmodSync(work, 0o700);
  const launched = family.launch({ provider: 'grok', model: 'grok-4.7' }, { workDir: work, bridgeArgs: [], env: { PATH: bin, HOME: work }, toolBudget: 10 });
  assert.equal(launched.transport, 'native_acp');
  assert.deepEqual(launched.invocation.args.slice(4, 6), ['--max-turns', '13']);
});
