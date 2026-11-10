# TipJar

Tip your favourite creators with NEAR or SOL.

- `frontend/` static site, wallet connect (NEAR and Solana)
- `backend/` Express API: wallet sign-in, tip ledger, payouts
- `contracts/tipjar/` NEAR escrow contract
- `programs/tip_vault/` Solana vault program (Anchor)
- `infra/` Dockerfile, compose, nginx; `.github/workflows/` deploy

```sh
docker compose -f infra/docker-compose.yml up
```
