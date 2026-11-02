# Dogfood

The registry contract is this repo's own code. Host tests:

```sh
cargo test --manifest-path contracts/review-registry/Cargo.toml
```

They cover payable `request_review`, a single-use hash, underpayment, operator attest, refund, and owner-only withdraw. A testnet deploy is not part of this pack.
