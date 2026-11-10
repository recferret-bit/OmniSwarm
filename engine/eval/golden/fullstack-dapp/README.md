# TipJar

Tip your favourite creators with NEAR, SOL or ETH.

- `frontend/` static site, wallet connect (NEAR, Solana and EVM)
- `backend/` Express API: wallet sign-in, tip ledger, payouts
- `contracts/tipjar/` NEAR escrow contract
- `contracts/evm/` EVM vault (Foundry)
- `programs/tip_vault/` Solana vault program (Anchor)
- `infra/` Dockerfile, compose, nginx; `.github/workflows/` deploy

```sh
docker compose -f infra/docker-compose.yml up
```
