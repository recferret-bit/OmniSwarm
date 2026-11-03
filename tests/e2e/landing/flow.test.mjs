import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { b58decode, decodeKey, verifyNep413 } from '../../../apps/api/src/lib.ts';
import { reportSha256 } from '../../../apps/api/src/worker.ts';
import { requestHash } from '@omniswarm/schemas/canonical-message';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LANDING = path.join(ROOT, 'apps/web');
const PORT = 4187;
const HERO = 'A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR';

function startLanding() {
  const viteBin = path.join(ROOT, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: LANDING,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite did not listen\n${log}`)), 20000);
    const watch = () => {
      if (log.includes('127.0.0.1:4187') || log.includes(`localhost:${PORT}`)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`vite exited ${code}\n${log}`));
    });
  });
  return { child, ready };
}

async function launchChrome() {
  return chromium.launch({ channel: 'chrome', headless: true });
}

test('landing mock flow signs NEP-413 and finishes at 360px', { timeout: 60000 }, async () => {
  const server = startLanding();
  let browser;
  try {
    await server.ready;
    try {
      browser = await launchChrome();
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      process.stderr.write(`browser launcher failed\n${message}\n`);
      throw error;
    }
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    const text = await page.locator('#root').innerText();
    assert.match(text, new RegExp(HERO.replace(/[.]/g, '\\.')));
    assert.ok(text.trim().length > 40, 'the page is blank');

    await page.getByRole('button', { name: 'View a sample report' }).click();
    await page.getByText('No wallet is required.').waitFor();
    await page.getByText('Attested (sample)').waitFor();
    await page.getByRole('link', { name: 'OmniSwarm' }).click();

    await page.getByRole('button', { name: 'Connect NEAR wallet' }).click();
    await page.getByTestId('account').waitFor();
    assert.match(await page.getByTestId('account').innerText(), /alice\.testnet/);

    await page.getByLabel('GitHub repository').fill('https://github.com/near/near-sdk-rs');
    await page.getByRole('button', { name: 'Quote' }).click();
    await page.getByText('1 NEAR').waitFor();
    await page.getByRole('button', { name: 'Sign request' }).click();
    await page.getByTestId('signature').waitFor();
    const signature = (await page.getByTestId('signature').innerText()).trim();
    const publicKey = (await page.getByTestId('public-key').innerText()).trim();
    const message = await page.getByTestId('signed-message').innerText();
    const nonce = (await page.getByTestId('nonce').innerText()).trim();
    const recipient = (await page.getByTestId('recipient').innerText()).trim();
    const shownHash = (await page.getByTestId('request-hash').innerText()).trim();
    assert.equal(publicKey.startsWith('ed25519:'), true);
    assert.equal(await requestHash(message), shownHash);
    assert.equal(verifyNep413(decodeKey(publicKey), b58decode(signature), message, Buffer.from(nonce, 'base64'), recipient), true);
    await page.getByRole('button', { name: 'Pay 1 NEAR' }).click();
    await page.getByRole('list', { name: 'Live timeline' }).waitFor();
    const first = await page.locator('[aria-label="Live timeline"] li').allTextContents();
    assert.deepEqual(first, ['queued']);
    await page.waitForFunction(() => {
      const items = [...document.querySelectorAll('[aria-label="Live timeline"] li')].map((node) => node.textContent);
      return items.includes('running') && !items.includes('done');
    });
    await page.getByText('hash matches on-chain attestation').waitFor();
    const findings = JSON.parse(await page.getByTestId('report-findings').innerText());
    const general = JSON.parse(await page.getByTestId('report-general').innerText());
    const recomputed = reportSha256(findings, general);
    assert.equal((await page.getByTestId('report-hash').innerText()).trim(), recomputed);
    assert.equal((await page.getByTestId('attested-hash').innerText()).trim(), recomputed);
    const steps = await page.locator('[aria-label="Live timeline"] li').allTextContents();
    assert.deepEqual(steps, ['queued', 'running', 'done']);

    await page.getByRole('button', { name: 'Tamper the report' }).click();
    await page.getByText('hash does not match the attestation').waitFor();
    const tamperedFindings = JSON.parse(await page.getByTestId('report-findings').innerText());
    const tamperedHash = reportSha256(tamperedFindings, general);
    assert.notEqual(tamperedHash, recomputed);
    assert.equal((await page.getByTestId('report-hash').innerText()).trim(), tamperedHash);

    await page.getByRole('link', { name: 'My requests' }).click();
    await page.getByText('near/near-sdk-rs').waitFor();
    assert.match(await page.locator('main').innerText(), /done/);

    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.getByLabel('GitHub repository').fill('https://github.com/private/hidden');
    await page.getByLabel('Mock').selectOption('REPO_PRIVATE');
    await page.getByRole('button', { name: 'Quote' }).click();
    await page.getByRole('alert').getByText('This repository is private').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Pay 1 NEAR' }).count(), 0);

    await page.getByLabel('Mock').selectOption('QUEUE_FULL');
    await page.getByLabel('GitHub repository').fill('https://github.com/near/near-sdk-rs');
    await page.getByRole('button', { name: 'Quote' }).click();
    await page.getByRole('alert').getByText('Queue is full, try later').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Pay 1 NEAR' }).count(), 0);

    await page.getByRole('button', { name: 'Connect NEAR wallet' }).click();
    await page.getByTestId('account').waitFor();
    await page.getByLabel('Mock').selectOption('WALLET_REJECT');
    await page.getByRole('button', { name: 'Quote' }).click();
    await page.getByRole('button', { name: 'Sign request' }).click();
    await page.getByRole('button', { name: 'Pay 1 NEAR' }).click();
    await page.getByRole('alert').getByText('Payment cancelled in wallet').waitFor();
    await page.getByRole('button', { name: 'Retry' }).waitFor();
    assert.equal(await page.locator('[aria-label="Live timeline"] li').count(), 0);
  } finally {
    if (browser) await browser.close();
    server.child.kill('SIGTERM');
  }
});
