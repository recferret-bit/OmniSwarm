import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLI_PROVIDERS, family, grokMaxTurnsSupport } from './provider-cli.mjs';

function fakeGrok(bin, help) {
  fs.mkdirSync(bin, { recursive: true });
  const body = help
    ? '#!/bin/sh\nif [ "$1" = agent ] && [ "$2" = "--help" ]; then echo "--max-turns N"; exit 0; fi\nexit 0\n'
    : '#!/bin/sh\nexit 0\n';
  fs.writeFileSync(path.join(bin, 'grok'), body, { mode: 0o755 });
}

function launchGrok(bin) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-work-'));
  fs.chmodSync(work, 0o700);
  return family.launch({ provider: 'grok', model: 'grok-4.7' }, { workDir: work, bridgeArgs: [], env: { PATH: bin, HOME: work }, toolBudget: 10 });
}

test('cli provider metadata names presence rows, transports and the --max-turns CLI', () => {
  assert.equal(family.providers, CLI_PROVIDERS);
  assert.deepEqual(Object.keys(CLI_PROVIDERS).filter((name) => CLI_PROVIDERS[name].presence), ['claude', 'codex', 'grok', 'agy']);
  assert.deepEqual(Object.fromEntries(Object.entries(CLI_PROVIDERS).map(([name, p]) => [name, p.transport])), {
    claude: 'maintained_acp', codex: 'maintained_acp', grok: 'native_acp', agy: 'native_cli_acp_adapter', 'claude-zai': 'maintained_acp',
  });
  assert.deepEqual(Object.keys(CLI_PROVIDERS).filter((name) => CLI_PROVIDERS[name].maxTurnsFlag), ['grok']);
});

test('a launch reports the transport from the provider table and passes --max-turns only when grok advertises it', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-bin-'));
  fakeGrok(plain, false);
  const without = launchGrok(plain);
  assert.equal(without.transport, 'native_acp');
  assert.equal(without.invocation.args.includes('--max-turns'), false);
  assert.deepEqual(without.invocation.args.slice(0, 4), ['agent', '--no-leader', '--model', 'grok-4.7']);
  assert.equal(without.invocation.args.at(-1), 'stdio');

  const advertised = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-bin-'));
  fakeGrok(advertised, true);
  const withFlag = launchGrok(advertised);
  assert.deepEqual(withFlag.invocation.args.slice(4, 6), ['--max-turns', '13']);
});

test('a blocked preflight does not probe the grok binary', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-bin-'));
  const marker = path.join(bin, 'called');
  fs.writeFileSync(path.join(bin, 'grok'), `#!/bin/sh\nprintf x > '${marker}'\nexit 1\n`, { mode: 0o755 });
  assert.equal(grokMaxTurnsSupport({ PATH: bin, HOME: bin, OMNI_SKIP_CLI_PROBE: '1' }), false);
  assert.equal(fs.existsSync(marker), false);
});
