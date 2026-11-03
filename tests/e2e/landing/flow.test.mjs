// W11 landing e2e on mocks: a production `next build` with MSW and the mock
// wallet, driven in headless Chrome at 360 px. Demo steps 1-11 of the wave file.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright-core';
import { digestReport } from '@omniswarm/schemas/canonical-json';
import { requestHash } from '@omniswarm/schemas/canonical-message';
import { b58decode, nep413Payload } from '@omniswarm/schemas/nep413';
import { listFiles, scan } from '../../../apps/web/scripts/bundle-scan.mjs';
import { axeViolations, BASE, buildMockApp, removeMockWorker, startMockApp } from './app.mjs';

const HERO = 'A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR';
let server;
let browser;
let mockBuild;

before(async () => {
  mockBuild = buildMockApp();
  server = await startMockApp();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, { timeout: 300_000 });

after(async () => {
  await browser?.close();
  server?.child.kill('SIGTERM');
  removeMockWorker();
});

async function newPage(query = '') {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/${query}`);
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  return page;
}

function verifyNep413({ publicKey, signature, message, nonce, recipient }) {
  const raw = Buffer.from(b58decode(publicKey.replace(/^ed25519:/, '')));
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
  const digest = crypto.createHash('sha256').update(nep413Payload(message, Buffer.from(nonce, 'base64'), recipient)).digest();
  return crypto.verify(null, digest, key, Buffer.from(signature, 'base64'));
}

async function quoteAndSign(page, repo) {
  await page.getByRole('button', { name: 'Connect NEAR wallet' }).first().click();
  await page.getByTestId('account').waitFor();
  await page.getByLabel('GitHub repository').fill(repo);
  await page.getByRole('button', { name: 'Get quote' }).click();
  await page.getByTestId('quote').waitFor();
  await page.getByRole('button', { name: 'Sign request' }).click();
  await page.getByTestId('request-hash').waitFor();
}

describe('landing on mocks', { concurrency: false }, () => {
  test('the mock build really contains the code the production guard bans', () => {
    const hits = scan(listFiles(path.join(mockBuild, 'static'))).map((hit) => hit.rule);
    for (const rule of ['MockConnector', 'MSW worker', 'mock controls']) assert.ok(hits.includes(rule), `guard missed ${rule} in the mock build`);
  });

  test('landing and sample report without a wallet, axe clean', { timeout: 60_000 }, async () => {
    const page = await newPage();
    const main = await page.locator('main').innerText();
    assert.match(main, new RegExp(HERO));
    for (const id of ['how', 'trust', 'pricing']) await page.locator(`#${id}`).waitFor();
    assert.match(await page.getByTestId('chain-status').innerText(), /Chain: mock \(dev\)/);
    assert.match(await page.locator('#pricing').innerText(), /1 NEAR \(testnet\)[\s\S]*2 passes × 40 tool calls/);
    assert.deepEqual(await axeViolations(page), []);

    await page.getByRole('link', { name: 'View a sample report' }).click();
    await page.getByText('No wallet is required to read a report.').waitFor();
    await page.getByText('Attested (sample)').waitFor();
    assert.match(await page.getByText(/not read from NEAR/).innerText(), /recorded sample attestation/);
    for (const tab of ['Per-model reports', 'Cross-check', 'General review']) {
      await page.getByRole('tab', { name: tab }).click();
      assert.equal(await page.getByRole('tab', { name: tab }).getAttribute('aria-selected'), 'true');
    }
    assert.deepEqual(await axeViolations(page), []);
  });

  test('connect, quote, sign NEP-413, pay, watch to done, verify, tamper, my requests', { timeout: 90_000 }, async () => {
    const page = await newPage('?mock=none');
    await quoteAndSign(page, 'https://github.com/near-examples/guest-book-examples');
    const quote = await page.getByTestId('quote').innerText();
    assert.match(quote, /1 NEAR/);
    assert.match(quote, /#0 in queue/);
    const read = async (id) => (await page.getByTestId(id).textContent()).trim();
    const signed = { publicKey: await read('public-key'), signature: await read('signature'), message: await read('signed-message'), nonce: await read('nonce'), recipient: 'omniswarm.testnet' };
    assert.equal(await requestHash(signed.message), await read('request-hash'));
    assert.equal(JSON.parse(signed.message).nonce, signed.nonce);
    assert.equal(verifyNep413(signed), true, 'the base64 NEP-413 signature verifies');

    await page.getByRole('button', { name: 'Pay 1 NEAR' }).click();
    await page.waitForURL(/\/r\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop();
    await page.getByRole('button', { name: 'Open report' }).waitFor({ timeout: 30_000 });
    assert.equal(await page.locator('[aria-current="step"]').innerText(), 'Done');
    assert.match(await page.getByRole('list', { name: 'Reviewers' }).innerText(), /pass 2\/2[\s\S]*pass 2\/2[\s\S]*pass 2\/2/);

    await page.getByRole('button', { name: 'Open report' }).click();
    await page.getByText('hash matches on-chain attestation').waitFor();
    const docs = await page.evaluate(async (rid) => Promise.all(['findings-and-scores.json', 'general-review.json']
      .map((name) => fetch(`https://reports.omniswarm.mock/${rid}/${name}`).then((response) => response.json()))), id);
    const recomputed = await digestReport(docs[0], docs[1]);
    assert.equal(await read('report-hash'), recomputed);
    assert.equal(await read('attested-hash'), recomputed);
    assert.ok(await page.getByRole('link', { name: 'View the attest transaction' }).count());
    assert.deepEqual(await axeViolations(page), []);

    await page.getByRole('button', { name: 'Tamper the report' }).click();
    await page.getByRole('button', { name: 'Verify again' }).click();
    await page.getByText('hash does not match the attestation').waitFor();
    assert.notEqual(await read('report-hash'), recomputed);

    await page.getByRole('link', { name: 'My requests' }).click();
    await page.getByRole('list', { name: 'Your requests' }).waitFor();
    assert.match(await page.getByRole('list', { name: 'Your requests' }).innerText(), /near-examples\/guest-book-examples[\s\S]*Done/);
  });

  test('failure paths: queue full, private repo, wallet reject + retry, payment lag, refund, SSE drop', { timeout: 120_000 }, async () => {
    let page = await newPage('?mock=QUEUE_FULL');
    await page.getByLabel('GitHub repository').fill('near/near-sdk-rs');
    await page.getByRole('button', { name: 'Get quote' }).click();
    await page.getByRole('alert').getByText('Queue is full, try later').waitFor();
    assert.equal(await page.getByRole('button', { name: /Sign request|Pay/ }).count(), 0);

    page = await newPage('?mock=REPO_PRIVATE');
    await page.getByLabel('GitHub repository').fill('near/near-sdk-rs');
    await page.getByRole('button', { name: 'Get quote' }).click();
    await page.getByRole('alert').getByText('This repository is private. Only public repositories can be reviewed.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Sign request' }).count(), 0);

    page = await newPage('?mock=PAYMENT_NOT_FOUND&wallet=reject');
    await quoteAndSign(page, 'near/near-sdk-rs');
    await page.getByRole('button', { name: 'Pay 1 NEAR' }).click();
    await page.getByRole('alert').getByText('Payment cancelled in wallet.').waitFor();
    await page.getByRole('button', { name: 'Retry' }).click();
    await page.waitForURL(/\/r\//, { timeout: 20_000 });

    page = await newPage('?mock=REVIEW_FAILED');
    await quoteAndSign(page, 'near/near-sdk-rs');
    await page.getByRole('button', { name: 'Pay 1 NEAR' }).click();
    await page.getByRole('link', { name: 'View the refund transaction' }).waitFor({ timeout: 30_000 });
    assert.equal(await page.locator('[aria-current="step"]').innerText(), 'Refunded');

    page = await newPage('?mock=SSE_DROP');
    await quoteAndSign(page, 'near/near-sdk-rs');
    await page.getByRole('button', { name: 'Pay 1 NEAR' }).click();
    await page.getByText('Live updates paused — refreshing every 5 seconds.').waitFor({ timeout: 20_000 });
  });

  test('/me signed out asks to connect', { timeout: 30_000 }, async () => {
    const page = await newPage();
    await page.getByRole('link', { name: 'My requests' }).click();
    await page.getByText('Connect your wallet to see your requests').waitFor();
  });
});
