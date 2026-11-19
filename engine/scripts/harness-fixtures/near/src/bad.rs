// Intentionally risky snippets for the harness self-test. Not a contract.
use near_sdk::env;

pub fn auth() -> String {
    env::signer_account_id().to_string()
}

#[init(ignore_state)]
pub fn migrate() {}

pub fn pay(account: AccountId, amount: u128, opt: Option<u128>) {
    let _ = amount.wrapping_add(1);
    let _ = amount as u64;
    let _ = env::promise_result(0);
    let _ = env::account_balance();
    Promise::new(account.clone()).deploy_contract(vec![]).then(other);
    let _ = opt.unwrap();
}

pub fn ft_transfer(receiver: AccountId, amount: U128) {}

pub fn ft_on_transfer(sender: AccountId, amount: U128) -> U128 {
    amount
}

pub fn mt_resolve_deposit(sender: AccountId, amount: U128) -> U128 {
    env::log_str(&format!("refund {sender}"));
    amount
}

pub fn draw() -> Vec<u8> {
    env::random_seed()
}

// Callback deserialization can fail even when the preceding call succeeds.
pub fn callback(#[callback_result] result: Result<U128, PromiseError>) {
    let _ = env::promise_result_checked(0, 4096);
}

pub fn tip(&mut self, amount: u128) {
    self.fees += amount;
    let net = amount - self.fee;
    self.a = LookupMap::new(b"a");
    let _ = self.items.iter().collect::<Vec<_>>();
}

pub fn on_withdraw(&mut self) {}

pub fn respond(&mut self, yield_id: CryptoHash, data: Vec<u8>) {
    env::promise_yield_resume(&yield_id, &data);
}

pub fn sign_foreign(&mut self, path: String) {
    let mpc = "v1.signer";
    let _ = (mpc, path);
}

pub fn storage_unregister(&mut self, force: Option<bool>) -> bool {
    let _ = force;
    true
}

pub fn register_worker(&mut self, quote_hex: String, codehash: String) -> bool {
    let _ = (quote_hex, codehash);
    true
}

pub fn verify_foreign_sig(&mut self, hash: Vec<u8>, sig: Vec<u8>, memo: String) {
    let _ = env::ecrecover(&hash, &sig, 0, false);
    let _ = env::ed25519_verify(&[0u8; 64], &hash, &[0u8; 32]);
    let used = env::storage_usage();
    let rem_gas = env::prepaid_gas().as_gas() - env::used_gas().as_gas();
    let _ = (used, rem_gas, env::promise_results_count());
    env::log_str(&format!("EVENT_JSON:{{\"standard\":\"nep141\",\"memo\":\"{memo}\"}}"));
}
