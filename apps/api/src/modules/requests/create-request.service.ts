// POST /api/requests (INTAKE section 3 step 5): canonical message, field rules, NEP-413 signature,
// FullAccess key on chain, the quote checks again for the signed repo and commit, account limits,
// then nonce consumption and the insert in one transaction.
import crypto from 'node:crypto';
import { requestHash } from '@omniswarm/schemas/canonical-message';
import type { ChainPort } from '../../chain/port.ts';
import type { Config } from '../../config/load.ts';
import { withTransaction, type Db, type Pool } from '../../db/pool.ts';
import { audit } from '../../db/repositories/audit.ts';
import { consumeNonce, peekNonce, type NonceState } from '../../db/repositories/nonces.ts';
import { accountUsage, insertRequest } from '../../db/repositories/requests.ts';
import type { GitHubPort } from '../../github/port.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, fail, isAppError } from '../../shared/errors.ts';
import { decodePublicKey, decodeSignature, verifyNep413 } from '../auth/nep413.ts';
import { parseSignedMessage, type SignedMessage } from '../auth/signed-message.ts';
import { checkRepo, priceFor } from '../quote/quote.service.ts';
import { accountPreset } from '../providers/account-keys.ts';
import { accountPresetProvider } from '@omniswarm/schemas/providers';

export interface CreateDeps { config: Config; pool: Pool; clock: Clock; chain: ChainPort; github: GitHubPort }
export interface CreateBody {
  accountId: string;
  publicKey: string;
  signature: string;
  message: string;
  nonce: string;
  pipelineMode?: 'full' | 'step-by-step' | 'stage-1';
}
export interface Created { requestId: string; requestHash: string; priceYocto: string; contractId: string }

const DAY_MS = 24 * 60 * 60 * 1000;

function refuseNonce(state: NonceState): void {
  if (state === 'used') fail('NONCE_USED', 'This challenge was already used');
  if (state === 'expired') fail('NONCE_EXPIRED', 'This challenge has expired');
  if (state === 'missing') fail('NONCE_UNKNOWN', 'Unknown challenge; request one from /api/challenge');
}

function checkFields(config: Config, body: CreateBody, message: SignedMessage): void {
  if (message.account !== body.accountId) fail('ACCOUNT_MISMATCH', 'The signed account does not match accountId');
  if (message.nonce !== body.nonce) fail('MESSAGE_INVALID', 'The signed nonce does not match the challenge');
  priceFor(config, message.network);
  // The configured hosted preset, or (when the operator lists it in ALLOWED_PRESETS) a review on the account's own key.
  const ownKey = accountPresetProvider(message.preset) !== null;
  if ((message.preset !== config.intake.hostedPreset && !ownKey) || !config.intake.allowedPresets.includes(message.preset)) {
    const allowed = config.intake.allowedPresets.filter((preset) => preset === config.intake.hostedPreset || accountPresetProvider(preset));
    fail('PRESET_NOT_ALLOWED', `Preset must be ${allowed.join(' or ')}`);
  }
}

function checkSignature(config: Config, body: CreateBody): void {
  const key = decodePublicKey(body.publicKey);
  const signature = decodeSignature(body.signature);
  const nonce = Buffer.from(body.nonce, 'base64');
  if (!key || !signature || !verifyNep413(key, signature, body.message, nonce, config.intake.recipient)) {
    fail('SIG_INVALID', 'The signature does not match the message');
  }
}

/** One review in progress and the daily cap. Shared with the password dashboard. */
export async function assertAccountCapacity(db: Db, config: Config, account: string, now: Date): Promise<void> {
  const usage = await accountUsage(db, account, new Date(now.getTime() - DAY_MS));
  if (usage.active > 0) fail('ACTIVE_REQUEST_EXISTS', 'This account already has a review in progress');
  if (usage.recent >= config.intake.requestsPerDay) fail('RATE_LIMITED', 'Daily request limit reached for this account');
}

async function checkAccount(deps: CreateDeps, account: string, now: Date): Promise<void> {
  await assertAccountCapacity(deps.pool, deps.config, account, now);
}

async function verify(deps: CreateDeps, body: CreateBody, now: Date): Promise<SignedMessage> {
  const message = parseSignedMessage(body.message);
  checkFields(deps.config, body, message);
  refuseNonce(await peekNonce(deps.pool, body.nonce, now));
  checkSignature(deps.config, body);
  const permission = await deps.chain.keyPermission(body.accountId, body.publicKey);
  if (permission !== 'FullAccess') fail('KEY_NOT_FULL_ACCESS', 'The signing key is not a full-access key of this account');
  return message;
}

export async function createRequest(deps: CreateDeps, body: CreateBody): Promise<Created> {
  const now = deps.clock.now();
  let message: SignedMessage;
  try {
    message = await verify(deps, body, now);
  } catch (error) {
    if (error instanceof AppError) await audit(deps.pool, { actor: 'api', requestId: null, event: 'verify_failed', data: { code: error.code }, now });
    throw error;
  }
  const checked = await checkRepo({ config: deps.config, db: deps.pool, github: deps.github }, message.repo, message.commit).catch((error: unknown) => {
    if (isAppError(error, 'REF_NOT_FOUND')) fail('REF_CHANGED', 'The signed commit no longer resolves');
    throw error;
  });
  if (checked.commitSha !== message.commit) fail('REF_CHANGED', 'The signed commit no longer resolves');
  await checkAccount(deps, message.account, now);
  // An account- preset runs on the key and models this account saved (signed in once with this account).
  const provider = accountPresetProvider(message.preset);
  const own = provider ? await accountPreset(deps, message.account, provider) : null;
  const hash = await requestHash(body.message);
  const id = crypto.randomUUID();
  const priceYocto = priceFor(deps.config, message.network);
  await withTransaction(deps.pool, async (client) => {
    refuseNonce(await consumeNonce(client, body.nonce, now));
    await insertRequest(client, {
      id, account: message.account, repo: checked.repo, commitSha: message.commit, network: message.network,
      preset: message.preset, deployed: message.deployed, requestHash: hash, priceYocto, now,
      models: own?.models ?? null, pipelineMode: body.pipelineMode ?? 'full',
    });
  });
  return { requestId: id, requestHash: hash, priceYocto, contractId: deps.config.intake.contractId };
}
