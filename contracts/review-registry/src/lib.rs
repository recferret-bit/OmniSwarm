use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near_bindgen, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

#[cfg(test)]
const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

#[derive(BorshSerialize, BorshStorageKey)]
enum Key {
    Requests,
    Attestations,
    ByAccount,
    ByRepo,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(crate = "near_sdk::serde")]
pub enum Status {
    Pending,
    Running,
    Done,
    Refunded,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Request {
    pub account: AccountId,
    pub deposit: U128,
    pub block_height: u64,
    pub status: Status,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Attestation {
    pub request_hash: String,
    pub repo: String,
    pub commit: String,
    pub report_sha256: String,
    pub report_uri: String,
    pub deployed: Option<AccountId>,
    pub code_hash: Option<String>,
    pub max_severity: String,
    pub block_height: u64,
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    operator: AccountId,
    treasury: AccountId,
    price: u128,
    earned: u128,
    requests: LookupMap<String, Request>,
    attestations: LookupMap<String, Attestation>,
    by_account: LookupMap<AccountId, String>,
    by_repo: LookupMap<String, Vec<String>>,
}

fn require_hash(hash: &str) {
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) {
        env::panic_str("ERR_HASH_FORMAT");
    }
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        serde_json::json!({
            "standard": "omniswarm",
            "version": "1.0.0",
            "event": event,
            "data": [data],
        })
    ));
}

#[near_bindgen]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, operator: AccountId, treasury: AccountId, price_yocto: U128) -> Self {
        if env::state_exists() {
            env::panic_str("ERR_ALREADY_INIT");
        }
        Self {
            owner,
            operator,
            treasury,
            price: price_yocto.0,
            earned: 0,
            requests: LookupMap::new(Key::Requests),
            attestations: LookupMap::new(Key::Attestations),
            by_account: LookupMap::new(Key::ByAccount),
            by_repo: LookupMap::new(Key::ByRepo),
        }
    }

    pub fn get_price(&self) -> U128 {
        U128(self.price)
    }

    pub fn set_price(&mut self, price_yocto: U128) {
        self.only_owner();
        self.price = price_yocto.0;
    }

    pub fn set_operator(&mut self, operator: AccountId) {
        self.only_owner();
        self.operator = operator;
    }

    #[payable]
    pub fn request_review(&mut self, request_hash: String) {
        require_hash(&request_hash);
        if self.requests.contains_key(&request_hash) {
            env::panic_str("ERR_HASH_USED");
        }
        let deposit = env::attached_deposit().as_yoctonear();
        if deposit < self.price {
            env::panic_str("ERR_DEPOSIT_LOW");
        }
        let account = env::predecessor_account_id();
        self.requests.insert(&request_hash, &Request {
            account: account.clone(),
            deposit: U128(deposit),
            block_height: env::block_height(),
            status: Status::Pending,
        });
        emit("review_requested", serde_json::json!({
            "request_hash": request_hash,
            "account": account,
            "deposit": deposit.to_string(),
        }));
    }

    pub fn mark_running(&mut self, request_hash: String) {
        self.only_operator();
        let mut request = self.take(&request_hash);
        if request.status != Status::Pending {
            env::panic_str("ERR_BAD_STATUS");
        }
        request.status = Status::Running;
        self.requests.insert(&request_hash, &request);
    }

    pub fn attest(
        &mut self,
        request_hash: String,
        repo: String,
        commit: String,
        report_sha256: String,
        report_uri: String,
        deployed: Option<AccountId>,
        code_hash: Option<String>,
        max_severity: String,
    ) {
        self.only_operator();
        let mut request = self.take(&request_hash);
        if request.status != Status::Pending && request.status != Status::Running {
            env::panic_str("ERR_BAD_STATUS");
        }
        request.status = Status::Done;
        let deposit = request.deposit.0;
        self.earned = self.earned.saturating_add(deposit);
        self.requests.insert(&request_hash, &request);
        let attestation = Attestation {
            request_hash: request_hash.clone(),
            repo: repo.clone(),
            commit,
            report_sha256,
            report_uri,
            deployed: deployed.clone(),
            code_hash,
            max_severity,
            block_height: env::block_height(),
        };
        self.attestations.insert(&request_hash, &attestation);
        if let Some(account) = deployed {
            self.by_account.insert(&account, &request_hash);
        }
        let mut hashes = self.by_repo.get(&repo).unwrap_or_default();
        hashes.push(request_hash.clone());
        self.by_repo.insert(&repo, &hashes);
        emit("review_attested", serde_json::json!({ "request_hash": request_hash, "repo": repo }));
    }

    pub fn refund(&mut self, request_hash: String) {
        let caller = env::predecessor_account_id();
        if caller != self.operator && caller != self.owner {
            env::panic_str("ERR_NOT_OPERATOR");
        }
        let mut request = self.take(&request_hash);
        if request.status != Status::Pending && request.status != Status::Running {
            env::panic_str("ERR_BAD_STATUS");
        }
        let deposit = request.deposit.0;
        request.status = Status::Refunded;
        self.requests.insert(&request_hash, &request);
        Promise::new(request.account.clone()).transfer(NearToken::from_yoctonear(deposit));
        emit("review_refunded", serde_json::json!({
            "request_hash": request_hash,
            "account": request.account,
            "deposit": deposit.to_string(),
        }));
    }

    pub fn withdraw(&mut self, amount: U128) {
        self.only_owner();
        if amount.0 > self.earned {
            env::panic_str("ERR_INSUFFICIENT_EARNED");
        }
        self.earned -= amount.0;
        Promise::new(self.treasury.clone()).transfer(NearToken::from_yoctonear(amount.0));
    }

    pub fn get_request(&self, request_hash: String) -> Option<Request> {
        self.requests.get(&request_hash)
    }

    pub fn get_attestation(&self, request_hash: String) -> Option<Attestation> {
        self.attestations.get(&request_hash)
    }

    pub fn get_attestation_for_account(&self, account: AccountId) -> Option<Attestation> {
        self.by_account.get(&account).and_then(|hash| self.attestations.get(&hash))
    }

    pub fn get_attestations_for_repo(&self, repo: String) -> Vec<Attestation> {
        self.by_repo.get(&repo).unwrap_or_default().into_iter().filter_map(|hash| self.attestations.get(&hash)).collect()
    }

    pub fn get_earned(&self) -> U128 {
        U128(self.earned)
    }
}

impl Contract {
    fn only_owner(&self) {
        if env::predecessor_account_id() != self.owner {
            env::panic_str("ERR_NOT_OWNER");
        }
    }

    fn only_operator(&self) {
        if env::predecessor_account_id() != self.operator {
            env::panic_str("ERR_NOT_OPERATOR");
        }
    }

    fn take(&self, hash: &str) -> Request {
        require_hash(hash);
        self.requests.get(&hash.to_string()).unwrap_or_else(|| env::panic_str("ERR_NOT_FOUND"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    const PRICE: u128 = ONE_NEAR;
    const HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn id(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn context(predecessor: &str, deposit: u128) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(id("review-registry.testnet"))
            .predecessor_account_id(id(predecessor))
            .signer_account_id(id(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_height(10);
        builder
    }

    fn init() -> Contract {
        testing_env!(context("owner.testnet", 0).build());
        Contract::new(id("owner.testnet"), id("operator.testnet"), id("treasury.testnet"), U128(PRICE))
    }

    fn as_account(predecessor: &str, deposit: u128) {
        testing_env!(context(predecessor, deposit).build());
    }

    #[test]
    fn pay_then_mark_and_attest() {
        let mut contract = init();
        as_account("alice.testnet", PRICE * 2);
        contract.request_review(HASH.to_string());
        assert_eq!(contract.get_request(HASH.to_string()).unwrap().status, Status::Pending);
        as_account("operator.testnet", 0);
        contract.mark_running(HASH.to_string());
        contract.attest(
            HASH.to_string(),
            "near/near-sdk-rs".to_string(),
            "a".repeat(40),
            "b".repeat(64),
            "https://reports.example/1".to_string(),
            Some(id("deployed.testnet")),
            Some("codehash".to_string()),
            "high".to_string(),
        );
        assert_eq!(contract.get_request(HASH.to_string()).unwrap().status, Status::Done);
        let found = contract.get_attestation_for_account(id("deployed.testnet")).unwrap();
        assert_eq!(found.max_severity, "high");
        assert!(get_logs().iter().any(|line| line.contains("review_attested")));
        assert_eq!(contract.get_earned().0, PRICE * 2);
    }

    #[test]
    #[should_panic(expected = "ERR_HASH_USED")]
    fn hash_is_single_use() {
        let mut contract = init();
        as_account("alice.testnet", PRICE * 2);
        contract.request_review(HASH.to_string());
        contract.request_review(HASH.to_string());
    }

    #[test]
    #[should_panic(expected = "ERR_DEPOSIT_LOW")]
    fn underpayment_is_rejected() {
        let mut contract = init();
        as_account("alice.testnet", PRICE / 2);
        contract.request_review(HASH.to_string());
    }

    #[test]
    #[should_panic(expected = "ERR_HASH_FORMAT")]
    fn bad_hash_is_rejected() {
        let mut contract = init();
        as_account("alice.testnet", PRICE * 2);
        contract.request_review("ABC".to_string());
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OPERATOR")]
    fn non_operator_cannot_attest() {
        let mut contract = init();
        as_account("alice.testnet", PRICE * 2);
        contract.request_review(HASH.to_string());
        contract.attest(HASH.to_string(), "a/b".into(), "c".repeat(40), "d".repeat(64), "https://x".into(), None, None, "low".into());
    }

    #[test]
    #[should_panic(expected = "ERR_BAD_STATUS")]
    fn refund_of_done_is_rejected() {
        let mut contract = init();
        as_account("alice.testnet", PRICE * 2);
        contract.request_review(HASH.to_string());
        as_account("operator.testnet", 0);
        contract.attest(HASH.to_string(), "a/b".into(), "c".repeat(40), "d".repeat(64), "https://x".into(), None, None, "low".into());
        contract.refund(HASH.to_string());
    }

    #[test]
    fn refund_of_pending_returns_the_deposit() {
        let mut contract = init();
        as_account("alice.testnet", PRICE * 2);
        contract.request_review(HASH.to_string());
        as_account("operator.testnet", 0);
        contract.refund(HASH.to_string());
        assert_eq!(contract.get_request(HASH.to_string()).unwrap().status, Status::Refunded);
        let log = get_logs().into_iter().find(|line| line.contains("review_refunded")).unwrap();
        assert!(log.contains(&(PRICE * 2).to_string()));
        assert_eq!(contract.get_earned().0, 0);
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn withdraw_is_owner_only() {
        let mut contract = init();
        as_account("alice.testnet", 0);
        contract.withdraw(U128(1));
    }

    #[test]
    #[should_panic(expected = "ERR_INSUFFICIENT_EARNED")]
    fn pending_deposits_are_not_withdrawable() {
        let mut contract = init();
        as_account("alice.testnet", PRICE * 2);
        contract.request_review(HASH.to_string());
        as_account("owner.testnet", 0);
        contract.withdraw(U128(PRICE));
    }

    #[test]
    fn owner_withdraws_only_earned() {
        let mut contract = init();
        as_account("alice.testnet", PRICE * 2);
        contract.request_review(HASH.to_string());
        as_account("operator.testnet", 0);
        contract.attest(HASH.to_string(), "a/b".into(), "c".repeat(40), "d".repeat(64), "https://x".into(), None, None, "none".into());
        as_account("owner.testnet", 0);
        contract.withdraw(U128(PRICE));
        assert_eq!(contract.get_earned().0, PRICE);
    }
}
