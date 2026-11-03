import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listFiles, scan } from './bundle-scan.mjs';

const dirs = [];
function bundle(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-scan-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return listFiles(dir).map((file) => ({ file, rel: path.relative(dir, file) }));
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const hitsOf = (files, extra) => scan(files.map((entry) => entry.file), extra).map((hit) => ({ file: path.basename(hit.file), rule: hit.rule }));

describe('bundle guard scanner', () => {
  it('passes clean output, including the real wallet code paths', () => {
    const files = bundle({ 'static/a.js': 'const e={WALLET_REJECTED:"Payment cancelled in wallet."};new NearConnector({network:"testnet"})' });
    expect(hitsOf(files)).toEqual([]);
  });

  it('names the file for a fake sk- key, a mock connector, a key-shaped string and the mock controls', () => {
    const files = bundle({
      'static/key.js': 'const k="sk-proj-AAAAAAAAAAAAAAAAAAAA"',
      'static/wallet.js': 'export const connectorName="MockConnector";const pk="ed25519:7CpbEbFrqQZ3o2vXQ4X8kB9u5Wn6cRzY1tHhJg2Lm3Ds"',
      'server/app/page.html': '<button>Tamper the report</button>',
      'static/msw.js': 'navigator.serviceWorker.register("/mockServiceWorker.js")',
      'static/map.js.map': '{"sourcesContent":["MockConnector"]}',
    });
    expect(hitsOf(files)).toEqual(expect.arrayContaining([
      { file: 'key.js', rule: 'sk- key' },
      { file: 'wallet.js', rule: 'MockConnector' },
      { file: 'wallet.js', rule: 'ed25519 key' },
      { file: 'page.html', rule: 'mock controls' },
      { file: 'msw.js', rule: 'MSW worker' },
    ]));
    expect(hitsOf(files).some((hit) => hit.file === 'map.js.map')).toBe(false);
  });

  it('flags an inlined fixture hash passed as an extra literal', () => {
    const hash = 'cd8a533dc78a6d48e47e7fbe6bb7f9f591badd1e5854564cd4f3dd8f09ca38ab';
    const files = bundle({ 'static/c.js': `const ATTESTED="${hash}"` });
    expect(hitsOf(files, [hash])).toHaveLength(1);
  });
});
