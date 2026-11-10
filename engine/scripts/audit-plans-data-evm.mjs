// EVM review checklist (Solidity, Vyper, and the wallet code in front of them). One row per check, grouped by the
// OWASP Smart Contract Top 10 2026 (SC01 to SC10, https://scs.owasp.org/sctop10) plus the areas that list leaves to
// other sources: signatures and permits (EIP-712, ERC-2612, ERC-1271), accounts (EIP-7702, ERC-4337), L2 and
// cross-chain, denial of service, privileged keys, build, and the wallet client. Each row names the surface whose
// reviewer gets it. Sources: OWASP SC Top 10 2026, the SWC registry, ethereum.org's Pectra/EIP-7702 guidance,
// Chainlink data-feed and L2 sequencer documentation, OpenZeppelin's ERC-4626 and upgradeable-contract guidance.
// Data only; imports nothing (mounted into the sandbox beside audit-plans.mjs).

export const EVM_GROUPS = {
  SC01: 'SC01 Access control',
  SC02: 'SC02 Business logic',
  SC03: 'SC03 Price oracle',
  SC04: 'SC04 Flash loans',
  SC05: 'SC05 Input validation',
  SC06: 'SC06 Unchecked external calls',
  SC07: 'SC07 Rounding and precision',
  SC08: 'SC08 Reentrancy',
  SC09: 'SC09 Overflow and underflow',
  SC10: 'SC10 Proxy and upgradeability',
  SIG: 'Signatures and permits',
  ACCT: 'Accounts (EIP-7702, ERC-4337)',
  L2: 'L2 and cross-chain',
  DOS: 'Denial of service',
  KEYS: 'Privileged keys',
  BUILD: 'Compiler and dependencies',
  WALLET: 'Wallet client',
};

// kind: 'contract' rows need contract source; 'client' rows need wallet or RPC client code.
export const EVM_CHECKS = [
  { group: 'SC01', surface: 'S1', kind: 'contract', text: 'List every `external`/`public` function that changes state or moves value and the modifier or check that guards it. A setter, mint, burn, pause, sweep, upgrade, initializer, `selfdestruct` or arbitrary `call`/`delegatecall` with none is the finding.' },
  { group: 'SC01', surface: 'S1', kind: 'contract', text: 'Authorization reads `msg.sender`. `tx.origin` is never authorization, and since EIP-7702 neither `tx.origin == msg.sender` nor `code.length == 0` proves the caller is a code-free account: they are not a reentrancy, flash-loan or bot guard.' },
  { group: 'SC01', surface: 'S1', kind: 'contract', text: 'Ownership and roles: transfer is two-step, renouncing cannot strand funds or freeze the protocol, and the account that grants a role is not the one that uses it.' },
  { group: 'SC01', surface: 'S1', kind: 'contract', text: 'Callbacks and hooks (swap and flash-loan callbacks, `onERC721Received`, `receive`, bridge receivers) check that `msg.sender` is the pool, token or messenger they expect.' },
  { group: 'SC02', surface: 'S3', kind: 'contract', text: 'Walk each value flow as a state machine: what must be true before deposit, withdraw, claim, borrow, liquidate; whether a claim can be repeated; whether reward and debt accounting is updated before the balance it depends on changes.' },
  { group: 'SC02', surface: 'S3', kind: 'contract', text: 'Accounting uses the contract\'s own ledger, not `balanceOf(address(this))` or `address(this).balance`, which anyone can raise by a donation or a forced ether send.' },
  { group: 'SC02', surface: 'S3', kind: 'contract', text: 'Swaps, deposits and redemptions take a caller-supplied minimum output and deadline. A minimum of zero or a deadline of `block.timestamp` is no protection.' },
  { group: 'SC03', surface: 'S3', kind: 'contract', text: 'A price never comes from a value one transaction can move: an AMM reserve, `slot0`, a pool balance or a share price read in the same block. Check the TWAP window and what happens when the source reverts.' },
  { group: 'SC03', surface: 'S3', kind: 'contract', text: 'Chainlink-style feeds: `latestRoundData` (not `latestAnswer`), answer greater than zero before the cast, `updatedAt` within that feed\'s heartbeat, `decimals()` read rather than assumed, and on an L2 the sequencer uptime feed with a grace period after a restart.' },
  { group: 'SC04', surface: 'S3', kind: 'contract', text: 'Anything computed from balances, reserves, total supply or voting power in the current block can be inflated with a flash loan: voting uses a past snapshot, collateral and share prices do not use live balances, and a deposit and withdrawal in one block cannot extract value.' },
  { group: 'SC05', surface: 'S2', kind: 'contract', text: 'Validate what callers and admins pass: zero address and zero amount, array lengths that must match, duplicates, bounds on fees and basis points, and bounds on loops. Privileged setters need bounds too.' },
  { group: 'SC05', surface: 'S2', kind: 'contract', text: 'A token, pool, router or callback target named by the caller is untrusted code. A contract that holds approvals or funds and forwards a caller-built `call` (target plus calldata) can be made to spend them.' },
  { group: 'SC05', surface: 'S2', kind: 'contract', text: 'Narrowing casts (`uint128(x)`, `uint64(x)`) and signed/unsigned casts truncate or wrap silently; `abi.decode` of caller bytes and assembly that reads calldata need length checks.' },
  { group: 'SC06', surface: 'S3', kind: 'contract', text: 'Every low-level `call`, `send` and `delegatecall` result is checked. `transfer` and `send` forward 2300 gas and fail for contract recipients.' },
  { group: 'SC06', surface: 'S3', kind: 'contract', text: 'ERC-20 calls go through SafeERC20: some tokens return nothing or false, some refuse a non-zero to non-zero approve, some take a fee or rebase (measure the balance received), some block or pause accounts and make a push payment revert.' },
  { group: 'SC06', surface: 'S3', kind: 'contract', text: 'A call to an address the caller chose can return a very large amount of data or burn the forwarded gas, and one reverting recipient in a loop blocks everyone: prefer pull payments and bound returned data.' },
  { group: 'SC07', surface: 'S3', kind: 'contract', text: 'Multiply before dividing, and round in the protocol\'s favour: down when paying out assets or minting shares, up when charging debt or burning shares. Check amounts that round to zero and tokens with different decimals.' },
  { group: 'SC07', surface: 'S3', kind: 'contract', text: 'Vaults and share tokens (ERC-4626 or home-made): the first depositor cannot inflate the share price by donating; look for virtual shares and a decimals offset, dead shares or a minimum first deposit.' },
  { group: 'SC08', surface: 'S3', kind: 'contract', text: 'State is written before any external call: ether sends, token transfers with hooks (ERC-777, ERC-721/1155 safe transfers), callbacks. Otherwise a guard must cover every function that shares the state, not only the one that makes the call.' },
  { group: 'SC08', surface: 'S3', kind: 'contract', text: 'Read-only reentrancy: a view function that other protocols use as a price is read mid-call while state is half-updated. Cross-contract reentrancy: two contracts share state but not a guard. A transient-storage guard (EIP-1153) needs a chain and compiler that support it.' },
  { group: 'SC09', surface: 'S3', kind: 'contract', text: 'Solidity before 0.8 checks nothing: every `+`, `-`, `*` on a caller-influenced value needs SafeMath or a bound. From 0.8, read each `unchecked` block and each assembly arithmetic the same way.' },
  { group: 'SC10', surface: 'S1', kind: 'contract', text: 'Initializers run once (`initializer`/`reinitializer`), initialize every parent, and the implementation\'s constructor calls `_disableInitializers()`. A callable initializer on a proxy or its implementation is a takeover.' },
  { group: 'SC10', surface: 'S4', kind: 'contract', text: 'Upgrades: `_authorizeUpgrade` (UUPS) or the proxy admin is access-controlled and held by a multisig or timelock; the storage layout is append-only, with gaps or ERC-7201 namespaces; the implementation has no `selfdestruct` or caller-chosen `delegatecall`; selectors do not clash between proxy and implementation.' },
  { group: 'SIG', surface: 'S1', kind: 'contract', text: 'Signature checks use a vetted library (`ECDSA.recover`, `SignatureChecker`) rather than raw `ecrecover`, which returns the zero address on failure and accepts malleable signatures; contract signers are verified through ERC-1271.' },
  { group: 'SIG', surface: 'S1', kind: 'contract', text: 'A signed message is EIP-712 typed data whose domain holds the chain id and the verifying contract, covers every field that matters (signer, recipient, token, amount), carries a per-signer nonce that is consumed and a deadline, and cannot be replayed on another chain, contract or call.' },
  { group: 'SIG', surface: 'S1', kind: 'contract', text: '`permit` (ERC-2612) can be front-run: a contract that calls it and assumes success can be blocked, so it must tolerate a spent permit. Hashing several dynamic values with `abi.encodePacked` is ambiguous.' },
  { group: 'ACCT', surface: 'S1', kind: 'contract', text: 'Code meant to run as an EIP-7702 delegate or a smart account: initialization cannot be front-run (it requires the account\'s signature or the ERC-4337 EntryPoint), storage is namespaced because a later delegate inherits it, the delegate is not an upgradeable proxy, no single relayer is trusted, and the original key still controls the account.' },
  { group: 'L2', surface: 'S3', kind: 'contract', text: 'Cross-chain and L2: a bridge or messenger receiver authenticates both the messenger and the remote sender and chain; L1-to-L2 senders are aliased; `block.number` and `block.timestamp` mean something different on some L2s; a paused sequencer can make prices and liquidations stale.' },
  { group: 'DOS', surface: 'S3', kind: 'contract', text: 'Loops over arrays that users can grow hit the block gas limit; a function that must pay every recipient fails when one reverts; ether can be forced into a contract, so no invariant may depend on an exact balance.' },
  { group: 'KEYS', surface: 'S4', kind: 'contract', text: 'Name each privileged role, who holds it (an EOA, a multisig, a timelock) and the worst a single key can do: pause, upgrade, set a fee to 100%, sweep funds. Privileged changes emit events. Nothing on chain is secret: `private` state and "random" values from block data are readable or predictable.' },
  { group: 'BUILD', surface: 'S5', kind: 'contract', text: 'The compiler is pinned (no floating `pragma`), the optimizer, via-IR and EVM-version settings are committed and supported by the target chains (`PUSH0`, transient storage), dependencies under `lib/` or `node_modules` are pinned to a release and not edited in place, and deploy scripts hold no literal key.' },
  { group: 'BUILD', surface: 'S5', kind: 'contract', text: '`forge`, `hardhat` and `solc` are not in the sandbox image. Do not install them. Contract tests, fuzzing and invariant runs were not executed: say so as a coverage gap, and read the existing tests to see which invariants they cover.' },
  { group: 'WALLET', surface: 'S1', kind: 'client', text: 'Sign-in with a wallet uses `personal_sign` over a message the server issued and re-checks (EIP-4361: domain, URI, chain id, nonce, expiry), never `eth_sign`, which signs an unreadable hash that can be a transaction.' },
  { group: 'WALLET', surface: 'S6', kind: 'client', text: 'Typed-data requests: the EIP-712 domain, the spender and the amount are fixed by the app, not taken from a URL, a `postMessage` or an API response. Flag unlimited approvals, `setApprovalForAll`, `permit` and Permit2 signatures the flow does not need, and any request for an EIP-7702 authorization.' },
  { group: 'WALLET', surface: 'S6', kind: 'client', text: 'Before sending, the client checks the connected chain id and takes contract addresses per chain from its own configuration; a request to add or switch a chain does not take its RPC URL from untrusted input.' },
  { group: 'WALLET', surface: 'S4', kind: 'client', text: 'No private key, mnemonic or relayer key in browser code or a public build variable; RPC provider keys in the bundle are public and need origin restrictions.' },
];

// Guidance lines for one surface. kinds: the EVM kinds detected ('contract', 'client'); with none given, every row.
export function evmSurfaceLines(code, kinds = null) {
  return EVM_CHECKS
    .filter((row) => row.surface === code && (!kinds || kinds.includes(row.kind)))
    .map((row) => `- EVM [${EVM_GROUPS[row.group]}]: ${row.text}`);
}
