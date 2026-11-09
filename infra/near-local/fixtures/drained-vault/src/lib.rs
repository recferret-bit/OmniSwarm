//! Local guard fixture deployed as `drained-vault.test.near`.
//! Alt wasm for the good-dex drift demo: a different code hash from good-dex.

use near_sdk::near;

#[near(contract_state)]
#[derive(Default)]
pub struct DrainedVault {}

#[near]
impl DrainedVault {
    pub fn vault_status(&self) -> &'static str {
        "drained-vault"
    }
}
