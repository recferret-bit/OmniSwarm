//! near-workspaces sandbox suite: the deployed wasm on a local `near-sandbox` node.
//!
//! Covers what the mock VM cannot: the `#[init]` and `#[private]` glue, real transfer receipts and
//! a transfer that bounces. Run it with `bash contracts/review-registry/scripts/test-sandbox.sh`,
//! which builds the wasm with `--cfg near` (as cargo-near does) and then runs
//! `cargo test --features sandbox --test workspaces`.
//!
//! `REVIEW_REGISTRY_WASM` overrides the wasm path. near-workspaces downloads the sandbox binary on
//! first use (or takes `NEAR_SANDBOX_BIN_PATH`). Host and CI only, never the review sandbox.

use near_sdk::serde_json::{json, Value};
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract, Worker};

type Sandbox = Worker<near_workspaces::network::Sandbox>;
type TestResult = Result<(), Box<dyn std::error::Error>>;

const PRICE: NearToken = NearToken::from_near(1);
const HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CODE_HASH: &str = "8iTgRHpmMG2DzuPFDyBXTSkdxJMKmdNfmYo1sJUFKVNS";

struct Registry {
    worker: Sandbox,
    contract: Contract,
    owner: Account,
    operator: Account,
}

fn wasm() -> Vec<u8> {
    let path = std::env::var("REVIEW_REGISTRY_WASM").unwrap_or_else(|_| {
        let target = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/target").into());
        format!("{target}/wasm32-unknown-unknown/release/review_registry.wasm")
    });
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}. Build the wasm first (see the header of tests/workspaces.rs)"))
}

async fn registry() -> Result<Registry, Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let contract = worker.dev_deploy(&wasm()).await?;
    let owner = worker.dev_create_account().await?;
    let operator = worker.dev_create_account().await?;
    let init = contract
        .call("new")
        .args_json(json!({ "owner": owner.id(), "operator": operator.id(), "treasury": owner.id(), "price_yocto": PRICE.as_yoctonear().to_string() }))
        .transact()
        .await?;
    assert!(init.is_success(), "{init:?}");
    Ok(Registry { worker, contract, owner, operator })
}

impl Registry {
    async fn pay(&self, payer: &Account, deposit: NearToken) -> TestResult {
        let paid = payer.call(self.contract.id(), "request_review").args_json(json!({ "request_hash": HASH })).deposit(deposit).transact().await?;
        assert!(paid.is_success(), "{paid:?}");
        Ok(())
    }

    async fn operator_call(&self, method: &str, args: Value) -> Result<ExecutionFinalResult, Box<dyn std::error::Error>> {
        Ok(self.operator.call(self.contract.id(), method).args_json(args).max_gas().transact().await?)
    }

    async fn view(&self, method: &str, args: Value) -> Result<Value, Box<dyn std::error::Error>> {
        Ok(self.contract.view(method).args_json(args).await?.json()?)
    }

    async fn locked(&self) -> Result<Value, Box<dyn std::error::Error>> {
        Ok(self.view("get_config", json!({})).await?["locked"].clone())
    }
}

fn failure_text(outcome: &ExecutionFinalResult) -> String {
    assert!(outcome.is_failure(), "expected a failure: {outcome:?}");
    format!("{:?}", outcome.failures())
}

fn events(outcome: &ExecutionFinalResult) -> Vec<Value> {
    outcome
        .logs()
        .iter()
        .filter_map(|line| line.strip_prefix("EVENT_JSON:"))
        .map(|body| near_sdk::serde_json::from_str(body).expect("event is JSON"))
        .collect()
}

#[tokio::test]
async fn request_attest_and_the_guard_view() -> TestResult {
    let r = registry().await?;
    let dex = r.worker.dev_create_account().await?;
    r.pay(&dex, PRICE).await?;
    assert!(r.operator_call("mark_running", json!({ "request_hash": HASH })).await?.is_success());
    let attest = r
        .operator_call(
            "attest",
            json!({
                "request_hash": HASH, "repo": "near/near-sdk-rs", "commit": "c".repeat(40), "report_sha256": "d".repeat(64),
                "report_uri": "https://reports.example/1", "deployed": dex.id(), "code_hash": CODE_HASH, "max_severity": "low",
            }),
        )
        .await?;
    assert!(attest.is_success(), "{attest:?}");
    assert!(events(&attest).iter().any(|e| e["event"] == "review_attested"));
    let attestation = r.view("get_attestation_for_account", json!({ "account": dex.id() })).await?;
    assert_eq!(attestation["request_hash"], HASH);
    assert_eq!(attestation["binding_confirmed"], true);
    assert_eq!(attestation["code_hash"], CODE_HASH);
    assert_eq!(r.view("get_request", json!({ "request_hash": HASH })).await?["status"], "Done");
    assert_eq!(r.view("get_earned", json!({})).await?, PRICE.as_yoctonear().to_string());
    Ok(())
}

#[tokio::test]
async fn refund_pays_the_requester_the_exact_deposit() -> TestResult {
    let r = registry().await?;
    let alice = r.worker.dev_create_account().await?;
    let deposit = NearToken::from_near(2);
    r.pay(&alice, deposit).await?;
    // Let the gas refund of alice's own call land before taking the baseline.
    r.worker.fast_forward(5).await?;
    let before = alice.view_account().await?.balance;
    let refund = r.operator_call("refund", json!({ "request_hash": HASH })).await?;
    assert!(refund.is_success(), "{refund:?}");
    assert!(refund.json::<bool>()?);
    // The operator paid the gas, so alice's balance moves by exactly the deposit.
    assert_eq!(alice.view_account().await?.balance.as_yoctonear(), before.as_yoctonear() + deposit.as_yoctonear());
    assert_eq!(r.view("get_request", json!({ "request_hash": HASH })).await?["status"], "Refunded");
    assert_eq!(r.locked().await?, "0");
    Ok(())
}

#[tokio::test]
async fn a_bounced_refund_restores_the_request() -> TestResult {
    let r = registry().await?;
    let alice = r.worker.dev_create_account().await?;
    r.pay(&alice, PRICE).await?;
    let deleted = alice.clone().delete_account(r.owner.id()).await?;
    assert!(deleted.is_success(), "{deleted:?}");
    let refund = r.operator_call("refund", json!({ "request_hash": HASH })).await?;
    // The transfer receipt fails (no such account); the callback sees it and returns false.
    assert!(events(&refund).iter().any(|e| e["event"] == "refund_failed"));
    assert!(!refund.json::<bool>()?);
    assert_eq!(r.view("get_request", json!({ "request_hash": HASH })).await?["status"], "Pending");
    assert_eq!(r.locked().await?, PRICE.as_yoctonear().to_string());
    Ok(())
}

#[tokio::test]
async fn a_second_new_is_rejected() -> TestResult {
    let r = registry().await?;
    let again = r
        .contract
        .call("new")
        .args_json(json!({ "owner": r.operator.id(), "operator": r.operator.id(), "treasury": r.operator.id(), "price_yocto": "1" }))
        .transact()
        .await?;
    assert!(failure_text(&again).contains("already been initialized"), "{again:?}");
    assert_eq!(r.view("get_config", json!({})).await?["owner"], r.owner.id().as_str());
    Ok(())
}

#[tokio::test]
async fn callbacks_are_private() -> TestResult {
    let r = registry().await?;
    r.pay(&r.owner, PRICE).await?;
    let cases = [
        ("on_refund_done", json!({ "request_hash": HASH, "previous": "Pending" })),
        ("on_withdraw_done", json!({ "treasury": r.owner.id(), "amount": "1" })),
    ];
    for (method, args) in cases {
        let outside = r.owner.call(r.contract.id(), method).args_json(args).transact().await?;
        assert!(failure_text(&outside).contains("is private"), "{method}: {outside:?}");
    }
    Ok(())
}

#[tokio::test]
async fn operator_reports_and_owner_retracts() -> TestResult {
    let r = registry().await?;
    let phish = json!({ "account_id": "phish.test.near" });
    let args = json!({ "account_id": "phish.test.near", "evidence_uri": "https://evidence.example/1", "reason": "drains approvals" });
    let stranger = r.owner.call(r.contract.id(), "report_address").args_json(args.clone()).transact().await?;
    assert!(failure_text(&stranger).contains("ERR_NOT_OPERATOR"));
    let reported = r.operator_call("report_address", args).await?;
    assert!(reported.is_success(), "{reported:?}");
    assert!(events(&reported).iter().any(|e| e["event"] == "address_reported"));
    assert_eq!(r.view("is_reported", phish.clone()).await?, true);
    assert_eq!(r.view("get_report", phish.clone()).await?["reporter"], r.operator.id().as_str());
    let retracted = r.owner.call(r.contract.id(), "retract_report").args_json(phish.clone()).transact().await?;
    assert!(retracted.is_success(), "{retracted:?}");
    assert_eq!(r.view("is_reported", phish).await?, false);
    Ok(())
}
