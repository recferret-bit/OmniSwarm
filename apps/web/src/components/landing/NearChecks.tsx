const CHECKS = [
  {
    k: '01',
    title: 'Contracts',
    libs: 'near-sdk, near-sdk-js',
    body: 'A production dependency marks a NEAR contract. The security-audit skill walks five checks: who may call each method (the predecessor, not the signer), promises and callbacks, token accounting and storage staking, arithmetic and JSON amounts, and host signature checks. Leads are written to near.md.',
  },
  {
    k: '02',
    title: 'Sandbox checks',
    libs: 'cargo-near 0.22.0, Semgrep',
    body: 'Each near-sdk cdylib crate runs near-build (cargo near build non-reproducible-wasm --locked --no-abi) and near-clippy. Semgrep runs the curated near-sdk, near-sdk-js, and NEAR AI rules. cargo test is not catalogued for a near-sdk package, and the report records that gap.',
  },
  {
    k: '03',
    title: 'Clients',
    libs: 'near-api-js, @near-js/*, @hot-labs/near-connect, near-kit, @fastnear/*, chainsig.js, py-near',
    body: 'Wallet and server clients are reviewed as signing flows. NEP-413 sign-in uses tag 2147484061, a one-time nonce, and a check that the recipient and callback origin match. That package’s npm test stays in the catalog. Rust clients are near-crypto, near-primitives, near-api, and near-jsonrpc-client.',
  },
  {
    k: '04',
    title: 'Intents',
    libs: '@defuse-protocol/one-click-sdk-typescript, @defuse-protocol/intents-sdk, @near-intents-agent-api/sdk',
    body: 'These libraries are leads only. A signed intent must bind the contract, nonce, deadline, recipient, and slippage. The package’s npm test is not run, and quote, deposit, and agent hosts are not called.',
  },
  {
    k: '05',
    title: 'NEAR AI',
    libs: '@neardefi/shade-agent-js, shade-agent-cli, @nearai/*, nearai-cloud-verifier, near-ai-cloud',
    body: 'A dependency, or the string cloud-api.near.ai, is a recognition lead. Shade Agent is an unaudited library, so the reviewer reads its controls in source. The review of the repository does not call NEAR AI Cloud. Your key is used only so the panel can read the source.',
  },
  {
    k: '06',
    title: 'Skill, and what stays uncalled',
    libs: 'engine/skills/security-audit/SKILL.md',
    body: 'Reviewers follow that skill and nothing else. The run does not call an RPC, a faucet, a chain-signature signer, OutLayer, or NEAR MCP. A v1.signer string is a lead in near.md. It does not by itself mark the repository as NEAR.',
  },
];

/** Short map of the NEAR review: libraries the harness recognizes, and the checks the skill and sandbox actually run. */
export function NearChecks() {
  return (
    <section className="land-section" id="near" aria-labelledby="near-title">
      <div className="container-wide">
        <header className="land-head">
          <p className="land-kicker"><i>02</i><span className="eyebrow">NEAR checks</span></p>
          <h2 id="near-title" className="h2">What the pipeline checks</h2>
          <p className="lede">
            Production manifests decide the surface. The security-audit skill then walks that surface. A regex hit stays a lead until a reviewer cites the line.
          </p>
        </header>
        <div className="near-grid">
          {CHECKS.map((item) => (
            <article className="card plate near-card" key={item.k}>
              <p className="label c-ember">{item.k}</p>
              <h3>{item.title}</h3>
              <p className="near-libs">{item.libs}</p>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
