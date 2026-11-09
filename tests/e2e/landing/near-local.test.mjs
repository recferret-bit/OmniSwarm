// W15-16 browser flow against a running `npm run stack:local` (NEAR_LOCAL defaults to 1).
// tests/e2e/run.mjs only accepts the landing suite and does not pick this file up.
// Run: node --test tests/e2e/landing/near-local.test.mjs
// The stack is not started or stopped here. OMNI_HTTP_PORT or E2E_BASE overrides the origin.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';

const PORT = process.env.OMNI_HTTP_PORT || '18480';
const BASE = (process.env.E2E_BASE || `http://omniswarm.localhost:${PORT}`).replace(/\/$/, '');
const EXPLORER = 'http://127.0.0.1:3031';
const REPO = 'near-examples/guest-book';

let browser;

function stackDown(error) {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(`stack is not answering at ${BASE} (${reason}). Start it with npm run stack:local`);
}

before(async () => {
  let home;
  try {
    home = await fetch(`${BASE}/`);
  } catch (error) {
    throw stackDown(error);
  }
  if (!home.ok) throw new Error(`stack at ${BASE} returned HTTP ${home.status}. Start it with npm run stack:local`);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, { timeout: 60_000 });

after(async () => {
  await browser?.close();
});

async function visibleText(locator) {
  if (!(await locator.count())) return '';
  return (await locator.first().innerText()).trim();
}

test('dev wallet, quote, sign, pay, status, report match, local explorer', { timeout: 240_000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const notes = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') notes.push(`console ${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => notes.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/wallet/accounts') || url.includes('/api/')) notes.push(`${response.status()} ${url}`);
  });
  const trace = () => (notes.length ? `\n${notes.slice(-40).join('\n')}` : '');

  await page.goto(`${BASE}/`);
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  const chain = page.getByTestId('chain-status');
  await chain.waitFor();
  const chainText = await chain.innerText();
  assert.match(chainText, /NEAR sandbox/, `expected the sandbox chain, got ${JSON.stringify(chainText)}${trace()}`);
  assert.match(chainText, /registry\.test\.near/);

  await page.getByRole('button', { name: 'Connect NEAR wallet' }).first().click();
  const account = page.getByTestId('account');
  const aliceChoice = page.getByRole('button', { name: /alice\.test\.near/ }).or(page.getByRole('option', { name: /alice\.test\.near/ }));
  const walletError = page.locator('.wallet-slot__error');
  await account.or(aliceChoice).or(walletError).first().waitFor({ timeout: 20_000 }).catch(async () => {
    assert.fail(`dev wallet did not connect${trace()}`);
  });
  if ((await aliceChoice.count()) && !(await account.count())) await aliceChoice.first().click();
  if ((await walletError.count()) && !(await account.count())) {
    assert.fail(`dev wallet connect failed: ${await walletError.innerText()}${trace()}`);
  }
  await account.waitFor();
  assert.match(await account.innerText(), /alice\.test\.near/, `connected account is not alice${trace()}`);

  await page.getByLabel('GitHub repository').fill(REPO);
  await page.getByRole('button', { name: 'Get quote' }).click();
  const quote = page.getByTestId('quote');
  const quoted = await quote.waitFor({ timeout: 30_000 }).then(() => true, () => false);
  assert.ok(quoted, `quote did not appear: ${await visibleText(page.getByRole('alert'))}${trace()}`);
  const quoteText = await quote.innerText();
  assert.match(quoteText, /1 NEAR/, quoteText);

  await page.getByRole('button', { name: 'Sign request' }).click();
  const signed = await page.getByTestId('request-hash').waitFor({ timeout: 30_000 }).then(() => true, () => false);
  assert.ok(signed, `sign did not finish: ${await visibleText(page.getByRole('alert'))}${trace()}`);

  await page.getByRole('button', { name: 'Pay 1 NEAR' }).click();
  const paid = await page.waitForURL(/\/r\/[0-9a-f-]{36}$/, { timeout: 90_000 }).then(() => true, () => false);
  assert.ok(paid, `payment did not open the status page: ${await visibleText(page.getByRole('alert'))}${trace()}`);
  const id = new URL(page.url()).pathname.split('/').pop();
  assert.match(id, /^[0-9a-f-]{36}$/);

  const status = page.locator('#status');
  await status.waitFor();
  const open = page.getByRole('button', { name: 'Open report' });
  const statusDeadline = Date.now() + 180_000;
  while (Date.now() < statusDeadline) {
    if (await open.count()) break;
    const statusText = await visibleText(status);
    if (/Refunded|Failed|Expired/.test(statusText)) {
      assert.fail(`review ${id} did not reach done:\n${statusText}${trace()}`);
    }
    await page.waitForTimeout(1_000);
  }
  assert.ok(await open.count(), `status did not reach done for ${id}:\n${await visibleText(status)}${trace()}`);
  assert.equal(await page.locator('[aria-current="step"]').innerText(), 'Done');

  await open.click();
  const match = page.getByText('hash matches on-chain attestation');
  const verifyProblem = page.getByText(/Could not verify the report|hash does not match the attestation|No attestation found/);
  const verifyDeadline = Date.now() + 60_000;
  while (Date.now() < verifyDeadline) {
    if (await match.count()) break;
    if (await verifyProblem.count()) {
      assert.fail(`report ${id} did not match:\n${await visibleText(page.locator('#attestation'))}${trace()}`);
    }
    await page.waitForTimeout(500);
  }
  assert.ok(await match.count(), `report ${id} did not show match:\n${await visibleText(page.locator('#attestation'))}${trace()}`);
  const reportHash = (await page.getByTestId('report-hash').textContent()).trim();
  const attestedHash = (await page.getByTestId('attested-hash').textContent()).trim();
  assert.equal(reportHash, attestedHash);
  assert.match(reportHash, /^[0-9a-f]{64}$/);

  const link = page.getByRole('link', { name: 'View the attest transaction' });
  const href = await link.getAttribute('href');
  assert.match(href ?? '', new RegExp(`^${EXPLORER}/txns/[1-9A-HJ-NP-Za-km-z]+$`), href ?? '');
  const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
  await popup.waitForLoadState('domcontentloaded');
  await popup.getByRole('heading', { level: 1 }).waitFor();
  const explorerText = await popup.locator('body').innerText();
  assert.match(popup.url(), new RegExp(`^${EXPLORER}/txns/`));
  assert.match(explorerText, /review_attested/, explorerText.slice(0, 2500));
  assert.doesNotMatch(explorerText, /Transaction not found|does not support tx status/);
  await context.close();
});
