//! Local guard fixture deployed as `good-dex.test.near`.
//! The method name and string differ from drained-vault so the wasm code hash differs.

use near_sdk::near;

#[near(contract_state)]
#[derive(Default)]
pub struct GoodDex {}

#[near]
impl GoodDex {
    pub fn dex_name(&self) -> &'static str {
        "good-dex"
    }
}
