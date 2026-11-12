// Landing e2e on mocks: a production `next build` with MSW and the mock wallet,
// driven in headless Chrome at 360 px. The landing has no paid quote flow any more
// (its components stay dormant and unit-tested): reviews run on the account's own
// NEAR AI key from the dashboard, and the optional USDC donation is the last section.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright-core';
import { digestReport } from '@omniswarm/schemas/canonical-json';
import { listFiles, scan } from '../../../apps/web/scripts/bundle-scan.mjs';
import { axeViolations, BASE, buildMockApp, removeMockWorker, startMockApp } from './app.mjs';

const HERO = 'A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR';
const USDC_TESTNET = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';
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

// Every same-origin link on the page resolves, and every #fragment has a target.
async function checkInternalLinks(page) {
  const hrefs = await page.$$eval('a[href]', (links) => links.map((link) => link.getAttribute('href')));
  for (const href of new Set(hrefs)) {
    if (href.startsWith('#')) assert.equal(await page.locator(href).count(), 1, `missing anchor ${href}`);
    else if (href.startsWith('/')) assert.equal((await fetch(new URL(href, BASE))).status, 200, `${href} does not resolve`);
  }
}

// The mock API's operator session (dev/e2e only). Real sign-in is Google, X or a NEAR wallet.
async function signInMock(page) {
  const status = await page.evaluate(() => fetch('/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'operator', password: 'operator' }),
  }).then((response) => response.status));
  assert.equal(status, 200);
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
    for (const id of ['how', 'trust', 'start', 'support']) await page.locator(`#${id}`).waitFor();
    assert.match(await page.getByTestId('chain-status').innerText(), /Chain: mock \(dev\)/);
    // No pricing and no paid quote form: the call to action is the dashboard on your own NEAR AI key.
    assert.equal(await page.locator('#pricing').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Get quote' }).count(), 0);
    assert.doesNotMatch(main, /Z\.AI|OpenRouter|1 NEAR \(testnet\)/);
    assert.match(await page.locator('#start').innerText(), /own NEAR AI key[\s\S]*charges nothing[\s\S]*\.\/bin\/audit local/);
    assert.equal(await page.locator('#start').getByRole('link', { name: 'Open the dashboard' }).getAttribute('href'), '/dashboard');
    assert.equal(await page.getByRole('link', { name: 'Review a repo' }).getAttribute('href'), '#start');
    // The donation section is the very last section of the landing.
    assert.equal(await page.locator('main .land > :last-child').getAttribute('id'), 'support');
    const support = await page.locator('#support').innerText();
    assert.match(support, /Servers, sandbox runners, storage, the domain and coffee/);
    assert.doesNotMatch(support, /OmniSwarm charges nothing/);
    assert.equal(await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Support' }).getAttribute('href'), '/#support');
    assert.match(support, /omniswarm\.testnet/);
    assert.match(support, /Send native USDC on NEAR only — not USDC\.e or another network\./);
    assert.ok(support.includes(USDC_TESTNET));
    assert.deepEqual(await axeViolations(page), []);
    await checkInternalLinks(page);

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

  test('donate USDC with the mock wallet: cancel, then send', { timeout: 60_000 }, async () => {
    const page = await newPage('?wallet=reject');
    const support = page.locator('#support');
    await support.scrollIntoViewIfNeeded();
    assert.ok(await support.getByRole('button', { name: 'Donate 5 USDC' }).isDisabled(), 'donating waits for a wallet');
    await support.getByRole('radio', { name: /25 USDC · A day of infrastructure/ }).check();
    await support.getByRole('button', { name: 'Connect NEAR wallet' }).click();
    await support.getByTestId('account').waitFor();
    await support.getByRole('button', { name: 'Donate 25 USDC' }).click();
    await support.getByText('Donation cancelled in wallet. Nothing was sent.').waitFor();

    await support.getByRole('radio', { name: /Custom amount/ }).check();
    await support.getByRole('textbox', { name: 'Amount in USDC' }).fill('1.234');
    await support.getByText(/at most 2 decimals/).waitFor();
    assert.ok(await support.getByRole('button', { name: 'Donate' }).isDisabled());
    await support.getByRole('textbox', { name: 'Amount in USDC' }).fill('2.5');
    await support.getByRole('button', { name: 'Donate 2.5 USDC' }).click();
    await support.getByText(/2\.5 USDC transfer sent/).waitFor();
    assert.match(await support.getByRole('link', { name: 'View the transaction' }).getAttribute('href'), /^https:\/\/[^/]+\/txns\/[1-9A-HJ-NP-Za-km-z]+$/);
    assert.deepEqual(await axeViolations(page), []);
  });

  test('dashboard on your own NEAR AI key: save key, pick a model, review to done, verify, tamper', { timeout: 90_000 }, async () => {
    const page = await newPage('?mock=none');
    await signInMock(page);
    await page.goto(`${BASE}/dashboard`);
    const settings = page.getByRole('tab', { name: 'Settings' });
    await settings.waitFor();
    // No key yet: the key panel opens first and says who pays. There is no hosted panel to pick.
    assert.equal(await settings.getAttribute('aria-selected'), 'true');
    await page.getByRole('tabpanel').getByText('Paste your NEAR AI Cloud API key to run reviews. You pay NEAR AI directly; OmniSwarm charges nothing.').waitFor();
    assert.doesNotMatch(await page.locator('main').innerText(), /Z\.AI|OpenRouter|Hosted panel/);
    await page.getByLabel('NEAR AI Cloud API key').fill('near-e2e-key');
    await page.getByRole('button', { name: 'Save key' }).click();
    await page.getByText(/Key saved · mock0000/).waitFor();
    assert.equal(await page.getByLabel('Replace NEAR AI Cloud API key').inputValue(), '', 'the key is never echoed back');
    await page.getByRole('button', { name: 'Load models from NEAR AI Cloud' }).click();
    await page.getByLabel('deepseek-ai/DeepSeek-V4', { exact: true }).click();
    await page.getByLabel('deepseek-ai/DeepSeek-V4 (orchestrator)').waitFor();
    assert.deepEqual(await axeViolations(page), []);

    await page.getByRole('tab', { name: 'New review' }).click();
    await page.getByText(/key with 1 model; deepseek-ai\/DeepSeek-V4 orchestrates/).waitFor();
    await page.getByLabel('GitHub repository').fill('https://github.com/near-examples/guest-book-examples');
    await page.getByRole('button', { name: 'Submit' }).click();
    const history = page.getByRole('list', { name: 'Request history' });
    await history.waitFor();
    assert.match(await history.innerText(), /near-examples\/guest-book-examples/);
    await history.getByRole('link', { name: 'near-examples/guest-book-examples' }).click();
    await page.waitForURL(/\/dashboard\/requests\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop();

    await page.getByRole('button', { name: 'Open report' }).waitFor({ timeout: 30_000 });
    assert.equal(await page.locator('[aria-current="step"]').innerText(), 'Done');
    const reviewers = await page.getByRole('list', { name: 'Reviewers' }).innerText();
    assert.match(reviewers, /pass 2\/2[\s\S]*pass 2\/2[\s\S]*pass 2\/2/);
    assert.match(reviewers, /nearai-deepseek-ai-deepseek-v4/);

    await page.getByRole('button', { name: 'Open report' }).click();
    await page.getByText('hash matches on-chain attestation').waitFor();
    const read = async (testId) => (await page.getByTestId(testId).textContent()).trim();
    const docs = await page.evaluate(async (rid) => Promise.all(['findings-and-scores.json', 'general-review.json']
      .map((name) => fetch(`https://reports.omniswarm.mock/${rid}/${name}`).then((response) => response.json()))), id);
    const recomputed = await digestReport(docs[0], docs[1]);
    assert.equal(await read('report-hash'), recomputed);
    assert.equal(await read('attested-hash'), recomputed);
    assert.deepEqual(await axeViolations(page), []);

    await page.getByRole('button', { name: 'Tamper the report' }).click();
    await page.getByRole('button', { name: 'Verify again' }).click();
    await page.getByText('hash does not match the attestation').waitFor();
    assert.notEqual(await read('report-hash'), recomputed);

    await page.getByRole('link', { name: 'All requests' }).click();
    await page.getByRole('tab', { name: 'Review history' }).click();
    assert.match(await page.getByRole('list', { name: 'Request history' }).innerText(), /near-examples\/guest-book-examples[\s\S]*done/i);
  });
});
