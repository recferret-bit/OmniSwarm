# Security policy

This is the security policy for the OmniSwarm repository and the hosted demo that runs from it. It is not about the repositories OmniSwarm reviews. To report a problem in one of those, contact its maintainers.

## Reporting a vulnerability

Report privately. Do not open a public issue, pull request or discussion.

- E-mail: `<SECURITY_CONTACT_EMAIL>` (the owner replaces this placeholder, see `docs/ops/OWNER_TASKS.md`).
- Or use GitHub's private vulnerability reporting: open **Security → Report a vulnerability** on this repository.

Include:
- the affected component and commit or release tag
- the steps to reproduce, and what an attacker gains
- whether you think a key, a payment or another user's data is exposed

What to expect:
- An acknowledgement within 3 working days.
- A first assessment within 10 working days.
- A fix or mitigation plan for confirmed issues.
- Credit in the release notes if you want it.

There is no bug bounty. We follow coordinated disclosure: please wait 90 days, or until a fix ships, whichever comes first, before you publish. If you need longer, say so in the report.

## Supported versions

| Version | Supported |
|---|---|
| `main` | yes |
| The release tag currently deployed to the hosted demo (testnet only, until 2026-11-25) | yes |
| Older tags and branches | no. Reproduce on `main` first |

Mainnet payments are off. The hosted demo takes testnet NEAR only.

## Scope

In scope:
- **Review engine** (`engine/`, `bin/audit`): escaping the review sandbox or the MCP bridge; a reviewer tool that executes target code, reaches the network or reads outside the staged target; a target repository that injects instructions the engine then follows; a forged or unvalidated report.
- **Keys**: any path by which a provider key, the operator function-call key, `SESSION_SECRET`, `ADMIN_TOKEN` or the Postgres password reaches the sandbox, the MCP bridge, a container other than the one that needs it, a report, a log, the browser or the repository.
- **Intake API and worker** (`apps/api/`): authentication and NEP-413 signature checks, payment verification, refunds, the admin listener, rate limits, SSRF through repository URLs.
- **Web app and reports origin** (`apps/web/`, `reports.<domain>`): script injection from target-controlled report content, escaping the reports CSP sandbox, CSRF, redirecting the optional donation transfer to an account other than the configured recipient.
- **Contract** (`contracts/review-registry/`): access control, attestation and refund rules, the deployed-account binding the agent guard reads.
- **Agent guard** (`packages/guard/`): a transaction the guard should block but lets through.
- **Infrastructure in this repository** (`infra/`, `.github/workflows/`): compose, nginx, host provisioning, firewall, deploy and CI.

Out of scope:
- Findings about third-party repositories in an OmniSwarm report. Reports are model output and are not verified exploits.
- Volumetric denial of service, spam, social engineering, physical attacks.
- Vulnerabilities in upstream services (NEAR AI Cloud, the vendors behind the local CLIs, NEAR RPC providers, GitHub). Report those upstream.
- Loss of testnet tokens.
- Anything that needs root, or membership in the `docker` group, on the host. That group is root-equivalent by design; see `infra/README.md`, "Docker access".
- Missing headers or banner disclosure with no demonstrated impact, self-XSS, and clickjacking of pages with no state-changing action.

## Testing rules (safe harbor)

Research done in good faith within these rules will not be pursued:
- Test against your own deployment (`npm run stack:local`, or your own host built from this repository), not against the hosted demo. On the hosted demo, use only normal flows at normal rates. Do not scan or fuzz it.
- Do not submit repositories, data or accounts that are not yours.
- Do not keep, use or share any key or personal data you come across. Report it and delete your copy.
- Stop and report as soon as you can show impact. Do not pivot further.

## How keys are handled

The full rule is in `AGENTS.md`, "Key policy". In short:
- **Provider keys:** a hosted review runs only on the signed-in account's own NEAR AI Cloud key (sealed in Postgres under `ACCOUNT_KEYS_SECRET`, bound to the account and provider, used only for that account's reviews; see `docs/providers.md`). The operator holds no provider key on the host. `./bin/audit local --provider nearai` reads `NEARAI_API_KEY` from the operator's own shell. Each reviewer process gets exactly one allow-listed variable, for its own provider. Keys never go to the MCP bridge or the sandbox. Reports record only a `keyFingerprint`. Reviewed source leaves the machine for NEAR AI Cloud.
- **On the host**, secrets live in `/etc/omniswarm/*.env` (`root:root 0600`), installed by `infra/deploy/secrets.sh`, which prints names and fingerprints only. `providers.env` is empty by design. Systemd hands the worker env (including `ACCOUNT_KEYS_SECRET`) to the worker units only. No container receives a provider key, and the gate (`npm run check:infra`) fails if a compose service declares one.
- **The operator key** is a NEAR function-call key limited to `mark_running`, `attest`, `refund` and `report_address` on the registry, with a 1 NEAR gas allowance. It reaches the worker only, as a systemd credential. The contract account's full-access key (the upgrade path) stays offline with the owner.
- **The repository** never holds a filled env file or a key. `tools/secret-sweep.sh` checks the index and the whole git history. On the host, `omniswarm-log-hygiene.timer` checks the logs every day.
- If a key leaks: revoke it at the provider first (GitHub token settings, or `near account delete-keys` for the operator key), then install a new one with `secrets.sh` and restart the workers. An account's own NEAR AI key is revoked at NEAR AI Cloud by its owner and cleared with `PUT /api/account/providers/nearai {"key": ""}`. Rotating `ACCOUNT_KEYS_SECRET` makes every saved account key unreadable (accounts save theirs again).
