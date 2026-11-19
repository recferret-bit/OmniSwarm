// Idioms the lead scan must not flag.
use near_sdk::{assert_one_yocto, env, require, BorshStorageKey};

#[derive(BorshStorageKey)]
enum StorageKey {
    Balances,
}

#[private]
pub fn on_settle() -> String {
    env::log_str("settled");
    env::predecessor_account_id().to_string()
}

#[init]
pub fn new() {
    let _ = LookupMap::new(StorageKey::Balances);
}

pub fn credit(owner: AccountId, balance: u128, small: u64) -> Option<u128> {
    assert_one_yocto();
    require!(env::predecessor_account_id() == owner, "owner only");
    let _ = env::attached_deposit();
    balance.checked_add(u128::from(small))
}

pub fn page(items: &[u128], from: usize, limit: usize) -> Vec<u128> {
    items.iter().skip(from).take(limit).copied().collect()
}

pub fn storage_balance_bounds() {}

pub fn emit_structured_event(serialized_json: &str) {
    let line = ["EVENT_JSON:", serialized_json].concat();
    env::log_str(&line);
}
