#!/usr/bin/env node
// Rebuild golden/fullstack-dapp/expected.json from code needles, so line numbers follow the source when it is
// edited. Each row names a file and a substring that must occur exactly once in it (or `nth` for a repeat).
// Usage: node engine/eval/build-expected.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden', 'fullstack-dapp');
const T = 'backend/src/routes/tips.js';
const A = 'backend/src/routes/admin.js';
const AUTH = 'backend/src/auth.js';
const APP = 'frontend/src/app.js';
const W = 'frontend/src/wallet.js';
const NEAR = 'contracts/tipjar/src/lib.rs';
const SOL = 'programs/tip_vault/src/lib.rs';
const EVM = 'contracts/evm/src/TipVault.sol';
const EVMJS = 'frontend/src/evm.js';
const SHARES = 'contracts/evm/src/TipShares.sol';
const CI = '.github/workflows/deploy.yml';

// [file, needle, class, title, severity, layer, extra]
const BUGS = [
  [T, "ILIKE '%${q}%'", 'sql-injection', 'creator search interpolates the query string into SQL', 'high', 'web2'],
  [T, "'SELECT * FROM tips WHERE id = $1'", 'idor', 'GET /tips/:id returns any sender\'s tip row', 'medium', 'web2'],
  [T, 'UPDATE creators SET ${sets}', 'mass-assignment', 'profile update takes column names from the request body', 'high', 'web2'],
  [T, 'await sendPayout(req.body.destination', 'race-condition', 'withdraw pays out before the unlocked balance is debited', 'critical', 'web2', { missedBy: ['baseline'] }],
  [T, "router.post('/tips/confirm'", 'missing-authentication', 'tip confirmation credits a balance with no authentication or on-chain check', 'critical', 'web2'],
  [A, "router.post('/admin/creators/:id/balance'", 'missing-authorization', 'balance override has no admin check', 'critical', 'web2'],
  [A, 'await fetch(req.body.url)', 'ssrf', 'avatar proxy fetches a caller-supplied URL', 'high', 'web2'],
  [A, 'exec(`pg_dump', 'command-injection', 'export builds a shell command from the query string', 'high', 'web2'],
  [AUTH, 'Math.random().toString(36)', 'weak-randomness', 'sign-in nonce comes from Math.random', 'medium', 'web2', { missedBy: ['paranoid'] }],
  [AUTH, 'String(message).includes(expected)', 'signature-replay', 'login accepts any signed text containing the nonce, never consumes it and does not bind the key to the wallet', 'high', 'web2'],
  [AUTH, "role: req.body.role || 'user'", 'privilege-escalation', 'login copies the role from the request body into the token', 'critical', 'web2'],
  ['backend/src/config.js', 'jwtSecret:', 'hardcoded-secret', 'JWT secret falls back to a literal', 'high', 'web2'],
  ['backend/src/server.js', 'cors({ origin: true, credentials: true })', 'cors', 'CORS reflects every origin with credentials', 'medium', 'web2'],
  ['backend/src/server.js', 'env: process.env', 'information-leak', 'error handler returns the stack and the process environment', 'high', 'web2'],
  ['backend/src/db.js', 'rejectUnauthorized: false', 'tls', 'database TLS verification is disabled', 'medium', 'web2'],
  ['backend/package.json', '"tipjar-sdk": "github:tipjar-labs/sdk"', 'supply-chain', 'dependency installed from an unpinned git branch, with no lockfile', 'medium', 'web2'],
  [APP, "$('creator').innerHTML", 'dom-xss', 'creator bio is written with innerHTML', 'high', 'web2'],
  [APP, "if (type === 'tipjar:sign')", 'postmessage-origin', 'message listener signs a transaction for any origin', 'critical', 'web2'],
  [APP, "await tipSolana(state.solana, params.get('to')", 'unconfirmed-transfer', 'a link with ?tip=&to= sends a transfer on page load', 'high', 'web2'],
  ['frontend/src/api.js', 'VITE_ADMIN_SECRET = import.meta.env', 'client-secret', 'an admin secret is shipped in the browser bundle', 'medium', 'web2'],
  ['frontend/index.html', 'marked.min.js', 'missing-sri', 'third-party scripts load without a version pin or integrity hash', 'medium', 'web2'],
  ['backend/src/payout.js', "'signed with', config.payoutKey", 'key-custody', 'payout private key is written to the log', 'high', 'web3'],
  [W, 'methodNames: [], allowance', 'wallet-access-key', 'function-call key covers every method with a 250 NEAR allowance', 'medium', 'web3'],
  [W, 'Transaction.from(Buffer.from(base64Tx', 'blind-signing', 'a serialized transaction from outside is signed without inspection', 'high', 'web3'],
  [NEAR, 'pub fn set_owner(&mut self, owner: AccountId) {', 'missing-access-control', 'set_owner has no caller check', 'critical', 'web3'],
  [NEAR, 'require!(env::signer_account_id() == self.owner', 'signer-vs-predecessor', 'set_fee authorizes the transaction signer instead of the predecessor', 'medium', 'web3', { missedBy: ['baseline'] }],
  [NEAR, 'token_balances: LookupMap::new(b"b")', 'storage-collision', 'two collections share the storage prefix b', 'high', 'web3'],
  [NEAR, 'let fee = amount * self.fee_bps / 10_000;', 'unchecked-arithmetic', 'fee math is unchecked and fee_bps is unbounded with overflow-checks off', 'medium', 'web3'],
  [NEAR, '.transfer(NearToken::from_yoctonear(amount.0))', 'callback-settlement', 'withdraw transfers before the balance is locked', 'critical', 'web3'],
  [NEAR, 'pub fn on_withdraw(', 'public-callback', 'on_withdraw callback is not #[private]', 'critical', 'web3'],
  [NEAR, 'pub fn ft_on_transfer(', 'ft-receiver', 'ft_on_transfer credits any caller without checking the token contract', 'high', 'web3'],
  ['contracts/tipjar/Cargo.toml', 'overflow-checks = false', 'release-profile', 'release profile turns overflow checks off', 'medium', 'web3'],
  [SOL, '#[account(init_if_needed, payer = authority', 'reinitialization', 'initialize can be re-run on a live vault', 'low', 'web3'],
  [SOL, 'vault.total = vault.total + amount;', 'unchecked-arithmetic', 'vault total uses unchecked addition', 'low', 'web3', { missedBy: ['paranoid'] }],
  [SOL, 'let fee = amount * vault.fee_bps / 10_000;', 'unchecked-arithmetic', 'withdraw fee math can overflow and underflow', 'medium', 'web3'],
  [SOL, "pub authority: AccountInfo<'info>,", 'missing-signer', 'withdraw authority is not a signer and is not bound to the vault', 'critical', 'web3'],
  [SOL, 'invoke(&ix, &[ctx.accounts.hook_program.clone()])?;', 'arbitrary-cpi', 'notify invokes a caller-chosen program', 'high', 'web3'],
  [EVM, 'pragma solidity ^0.7.0;', 'compiler', 'floating pre-0.8 compiler: arithmetic is unchecked', 'medium', 'web3'],
  [EVM, 'function initialize(address _owner, uint256 _feeBps) external {', 'unprotected-initializer', 'initialize can be called by anyone, at any time, to take ownership', 'critical', 'web3'],
  [EVM, 'require(tx.origin == owner, "owner only");', 'tx-origin', 'setFeeCollector authorizes tx.origin', 'medium', 'web3', { missedBy: ['baseline'] }],
  [EVM, 'uint256 fee = msg.value * feeBps / 10000;', 'unchecked-arithmetic', 'unbounded feeBps makes the tip subtraction underflow', 'medium', 'web3'],
  [EVM, 'IERC20(token).transferFrom(msg.sender, address(this), amount);', 'unchecked-erc20', 'token tip ignores the transferFrom result and credits the requested amount', 'medium', 'web3'],
  [EVM, '(bool ok, ) = msg.sender.call{value: amount}("");', 'reentrancy', 'withdraw sends ether before it debits the balance', 'critical', 'web3'],
  [EVM, 'address signer = ecrecover(digest, v, r, s);', 'signature-replay', 'withdrawFor signature has no nonce, deadline or domain and pays whoever submits it', 'critical', 'web3'],
  [EVM, 'balances[creator] -= amount;', 'unchecked-arithmetic', 'withdrawFor debits without a balance check and underflows', 'high', 'web3', { missedBy: ['paranoid'] }],
  [EVM, '(bool ok, bytes memory result) = target.delegatecall(data);', 'delegatecall', 'execute delegatecalls an arbitrary target with the vault storage', 'high', 'web3'],
  [EVM, 'selfdestruct(payable(feeCollector));', 'missing-access-control', 'destroy has no caller check', 'critical', 'web3'],
  [EVMJS, "new Wallet('0x1111", 'key-custody', 'a relayer private key is embedded in the browser bundle', 'high', 'web3'],
  [EVMJS, 'await erc20.approve(VAULT, MaxUint256);', 'unlimited-approval', 'token tip approves the vault for the whole balance', 'medium', 'web3'],
  [EVMJS, "method: 'eth_sign'", 'blind-signing', 'login uses eth_sign on a server-supplied message', 'high', 'web3'],
  [SHARES, 'require(msg.sender == tx.origin, "no contracts");', 'eoa-check', 'onlyHuman treats tx.origin == msg.sender as proof the caller has no code', 'medium', 'web3', { missedBy: ['baseline'] }],
  [SHARES, 'return asset.balanceOf(address(this));', 'donation', 'totalAssets reads the live token balance, which anyone can raise by a transfer', 'high', 'web3'],
  [SHARES, 'minted = totalShares == 0 ? assets : assets * totalShares / totalAssets();', 'share-inflation', 'the first depositor can inflate the share price so later deposits mint zero shares', 'critical', 'web3'],
  [SHARES, '(, int256 answer, , , ) = feed.latestRoundData();', 'oracle-staleness', 'the feed answer is used with no sign, freshness or sequencer check', 'high', 'web3'],
  [SHARES, 'return uint256(reserve1) * 1e18 / reserve0;', 'spot-price', 'the borrow limit is priced from pool reserves a flash loan can move', 'critical', 'web3'],
  [SHARES, 'return amount / 10000 * bps;', 'precision', 'the fee divides before it multiplies and rounds small amounts to zero', 'low', 'web3', { missedBy: ['paranoid'] }],
  [SHARES, 'rewards[creator] += uint96(amount);', 'narrowing-cast', 'a recorded tip is truncated to 96 bits', 'medium', 'web3'],
  [SHARES, 'for (uint256 i = 0; i < creators.length; i++) {', 'denial-of-service', 'payAll loops over every creator and one failing transfer blocks all payouts', 'medium', 'web3'],
  [SHARES, 'function upgradeTo(address next) external {', 'unprotected-upgrade', 'anyone can set the implementation the fallback delegatecalls', 'critical', 'web3'],
  [EVMJS, 'return nft.setApprovalForAll(VAULT, true);', 'unlimited-approval', 'the vault is approved for the whole NFT collection', 'medium', 'web3'],
  [EVMJS, 'return walletClient.signAuthorization({ contractAddress: delegate, chainId: 0 });', 'eip7702-delegation', 'an EIP-7702 delegation is signed for a contract taken from the URL, valid on every chain', 'critical', 'web3'],
  [EVMJS, "method: 'wallet_addEthereumChain', params: [chain]", 'untrusted-chain', 'the wallet is asked to add a network whose RPC URL comes from an API response', 'medium', 'web3'],
  ['infra/Dockerfile', 'FROM node:18', 'container-base', 'end-of-life unpinned base image running as root', 'medium', 'infra'],
  ['infra/Dockerfile', 'curl -fsSL', 'curl-pipe-shell', 'image build pipes a remote script into bash', 'high', 'infra'],
  ['infra/Dockerfile', 'COPY infra/production.env', 'secret-in-image', 'production secrets are copied into the image', 'high', 'infra'],
  ['infra/Dockerfile', '--inspect=0.0.0.0:9229', 'debug-port', 'Node inspector listens on every interface', 'high', 'infra'],
  ['infra/production.env', 'PAYOUT_PRIVATE_KEY=', 'committed-secret', 'payout key and JWT secret are committed', 'critical', 'infra'],
  ['infra/docker-compose.yml', 'privileged: true', 'privileged-container', 'api container runs privileged', 'high', 'infra'],
  ['infra/docker-compose.yml', '/var/run/docker.sock:/var/run/docker.sock', 'docker-socket', 'Docker socket is mounted into the api container', 'high', 'infra'],
  ['infra/docker-compose.yml', '"0.0.0.0:5432:5432"', 'exposed-database', 'Postgres with a default password is published on every interface', 'medium', 'infra', { missedBy: ['baseline'] }],
  ['infra/nginx.conf', 'listen 80;', 'no-tls', 'proxy serves plain HTTP only', 'medium', 'infra'],
  ['infra/nginx.conf', 'autoindex on;', 'directory-listing', 'directory listing is enabled', 'low', 'infra'],
  ['infra/nginx.conf', 'proxy_set_header X-Forwarded-For $http_x_forwarded_for;', 'spoofable-client-ip', 'proxy forwards the client-supplied X-Forwarded-For', 'medium', 'infra'],
  [CI, 'pull_request_target:', 'ci-untrusted-checkout', 'pull_request_target workflow checks out and runs the PR head with secrets', 'critical', 'infra'],
  [CI, 'permissions: write-all', 'ci-permissions', 'workflow token has write-all permissions', 'medium', 'infra'],
  [CI, 'actions/checkout@main', 'unpinned-action', 'checkout action follows a moving branch', 'medium', 'infra'],
  [CI, 'echo "deploying with', 'ci-secret-log', 'deploy step echoes a secret', 'high', 'infra'],
  [CI, 'github.event.head_commit.message', 'ci-script-injection', 'commit message is interpolated into a shell step', 'high', 'infra'],
];

// [file, needle, reason, claim, layer, extra]
const DECOYS = [
  [AUTH, 'crypto.timingSafeEqual(given, wanted)', 'the service key is compared in constant time and an empty key is refused', 'service key comparison leaks timing', 'web2'],
  [T, "'SELECT id, handle, bio FROM creators WHERE id = $1'", 'the creator id is a bound parameter', 'creator lookup builds SQL from the path', 'web2'],
  [A, "execFile('node', ['scripts/reindex.js']", 'execFile takes a fixed argv with no request data', 'reindex runs a shell command from the request', 'web2'],
  [APP, 'if (event.origin !== window.location.origin) return;', 'the status listener checks the origin first', 'status listener trusts any origin', 'web2'],
  [APP, 'row.textContent = creator.handle;', 'the handle is written with textContent', 'creator list renders the handle as HTML', 'web2'],
  [NEAR, 'require!(env::predecessor_account_id() == self.owner, "owner only");', 'set_paused checks the predecessor against the owner', 'set_paused has no access control', 'web3', { nth: 1 }],
  [NEAR, 'self.fees = 0;', 'fees are zeroed before the transfer, behind one yocto and the owner check', 'collect_fees can be drained twice', 'web3'],
  [SOL, '#[account(mut, seeds = [b"vault", vault.authority.as_ref()], bump = vault.bump)]', 'the vault PDA is re-derived with the stored canonical bump', 'deposit accepts a forged vault account', 'web3'],
  [SOL, '#[account(mut, close = authority, has_one = authority', 'close requires has_one and a signing authority', 'anyone can close the vault', 'web3'],
  [EVM, 'function withdrawToken(address token, uint256 amount) external nonReentrant {', 'the guard is set and the balance is debited before the token call', 'token withdraw is reentrant', 'web3'],
  [EVM, 'require(msg.sender == pendingOwner, "not pending owner");', 'ownership transfer is two-step and only the pending owner can accept', 'anyone can accept ownership', 'web3'],
  [SHARES, 'require(!initialized, "already initialized");', 'the initializer runs once and is guarded by a flag', 'initialize can be called again to take ownership', 'web3'],
  [SHARES, 'require(signer != address(0) && signer == owner, "bad signature");', 'the claim is EIP-712 typed data with the chain id, a consumed nonce, a deadline and a zero-address check', 'the claim signature can be replayed', 'web3'],
  ['infra/nginx.conf', 'allow 10.0.0.0/8;', 'the internal location is limited to the private range and denies the rest', 'internal location is public', 'infra'],
  ['infra/docker-compose.yml', 'image: nginx:1.27.2@sha256:', 'the proxy image is pinned by digest and read-only', 'proxy image follows a moving tag', 'infra'],
  [CI, 'actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a', 'the action is pinned to a commit', 'setup-node action is unpinned', 'infra'],
];

function lineOf(file, needle, nth = 0) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  const hits = lines.map((text, i) => (text.includes(needle) ? i + 1 : 0)).filter(Boolean);
  if (!hits.length) throw new Error(`${file}: needle not found: ${needle}`);
  if (!nth && hits.length > 1) throw new Error(`${file}: needle matches ${hits.length} lines: ${needle}`);
  return hits[(nth || 1) - 1];
}

export function buildExpected() {
  const at = (file, needle, extra = {}) => { const line = lineOf(file, needle, extra.nth); return { file, startLine: line, endLine: line }; };
  return {
    stack: 'fullstack',
    layers: ['web2', 'web3', 'infra'],
    bugs: BUGS.map(([file, needle, cls, title, severity, layer, extra]) => ({ ...at(file, needle, extra), class: cls, title, severity, layer, ...(extra?.missedBy ? { missedBy: extra.missedBy } : {}) })),
    decoys: DECOYS.map(([file, needle, reason, claim, layer, extra]) => ({ ...at(file, needle, extra), reason, claim, layer })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = `${JSON.stringify(buildExpected(), null, 2)}\n`;
  const file = path.join(ROOT, 'expected.json');
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error('fullstack-dapp/expected.json is stale: run node engine/eval/build-expected.mjs'); process.exit(1); }
    console.log('fullstack-dapp/expected.json is current');
  } else {
    fs.writeFileSync(file, text);
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}
