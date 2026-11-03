//! Unit tests on the near-sdk mock VM. Helpers live here; rules live in the submodules.

mod admin;
mod deploy_script;
mod events;
mod money;
mod review;
mod validation;
mod views;

use near_sdk::json_types::U128;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{serde_json, testing_env, AccountId, NearToken, PromiseResult};

use crate::{Contract, Status};

pub(super) const ONE_NEAR: u128 = 10u128.pow(24);
pub(super) const PRICE: u128 = ONE_NEAR;
pub(super) const HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
pub(super) const HASH2: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
pub(super) const CODE_HASH: &str = "8iTgRHpmMG2DzuPFDyBXTSkdxJMKmdNfmYo1sJUFKVNS";
pub(super) const CONTRACT: &str = "review-registry.testnet";
pub(super) const BALANCE: u128 = 100 * ONE_NEAR;
/// Storage the mock reports at the start of every call, and its stake at the test byte cost.
pub(super) const STORAGE_BYTES: u64 = 300_000;
pub(super) const STAKE: u128 = STORAGE_BYTES as u128 * 10u128.pow(19);

pub(super) fn id(name: &str) -> AccountId {
    name.parse().unwrap()
}

pub(super) fn context(predecessor: &str, deposit: u128) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(id(CONTRACT))
        .predecessor_account_id(id(predecessor))
        .signer_account_id(id(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_yoctonear(BALANCE))
        .storage_usage(STORAGE_BYTES)
        .block_height(10);
    builder
}

pub(super) fn init() -> Contract {
    testing_env!(context("owner.testnet", 0).build());
    Contract::new(id("owner.testnet"), id("operator.testnet"), id("treasury.testnet"), U128(PRICE))
}

pub(super) fn as_account(predecessor: &str, deposit: u128) {
    testing_env!(context(predecessor, deposit).build());
}

/// The contract calling itself back after one promise with `result`.
pub(super) fn as_callback(result: PromiseResult) {
    let ctx = context(CONTRACT, 0).build();
    testing_env!(ctx, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

pub(super) fn pay(contract: &mut Contract, account: &str, hash: &str, deposit: u128) {
    as_account(account, deposit);
    contract.request_review(hash.to_string());
}

pub(super) struct AttestArgs {
    pub repo: String,
    pub commit: String,
    pub report_sha256: String,
    pub report_uri: String,
    pub deployed: Option<AccountId>,
    pub code_hash: Option<String>,
    pub max_severity: String,
}

impl AttestArgs {
    pub fn new(deployed: Option<&str>) -> Self {
        Self {
            repo: "near/near-sdk-rs".into(),
            commit: "c".repeat(40),
            report_sha256: "d".repeat(64),
            report_uri: "https://reports.example/1".into(),
            deployed: deployed.map(id),
            code_hash: deployed.map(|_| CODE_HASH.to_string()),
            max_severity: "low".into(),
        }
    }
}

/// Calls `attest` as whoever the current context says is the predecessor.
pub(super) fn attest_with(contract: &mut Contract, hash: &str, args: AttestArgs) {
    contract.attest(hash.into(), args.repo, args.commit, args.report_sha256, args.report_uri, args.deployed, args.code_hash, args.max_severity);
}

pub(super) fn attest_as_operator(contract: &mut Contract, hash: &str, deployed: Option<&str>) {
    as_account("operator.testnet", 0);
    attest_with(contract, hash, AttestArgs::new(deployed));
}

pub(super) fn status(contract: &Contract, hash: &str) -> Status {
    contract.get_request(hash.to_string()).unwrap().status
}

/// Parsed NEP-297 events from this call's logs.
pub(super) fn events() -> Vec<serde_json::Value> {
    get_logs()
        .iter()
        .map(|line| {
            let body = line.strip_prefix("EVENT_JSON:").expect("every log is an event");
            serde_json::from_str(body).expect("event is JSON")
        })
        .collect()
}

pub(super) fn event(name: &str) -> serde_json::Value {
    events().into_iter().find(|e| e["event"] == name).unwrap_or_else(|| panic!("no {name} event"))
}

/// `(receiver, yocto)` for every Transfer this call created.
pub(super) fn transfers() -> Vec<(AccountId, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|receipt| {
            let receiver = receipt.receiver_id.clone();
            receipt.actions.into_iter().filter_map(move |action| match action {
                MockAction::Transfer { deposit, .. } => Some((receiver.clone(), deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}

/// Method names of the callbacks this call scheduled.
pub(super) fn callbacks() -> Vec<String> {
    get_created_receipts()
        .into_iter()
        .flat_map(|receipt| receipt.actions)
        .filter_map(|action| match action {
            MockAction::FunctionCallWeight { method_name, .. } => Some(String::from_utf8(method_name).unwrap()),
            _ => None,
        })
        .collect()
}
