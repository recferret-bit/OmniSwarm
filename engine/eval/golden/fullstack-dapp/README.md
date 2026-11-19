# TipJar

Tip your favourite creators with NEAR.

- `frontend/` static site, NEAR wallet connect
- `backend/` Express API: wallet sign-in, tip ledger, payouts
- `contracts/tipjar/` NEAR escrow contract
- `infra/` Dockerfile, compose, nginx; `.github/workflows/` deploy

```sh
docker compose -f infra/docker-compose.yml up
```
