use near_sdk::env;

use super::*;
use crate::Report;

const EVIDENCE: &str = "https://evidence.example/phish-1";

fn report(contract: &mut Contract, account: &str) {
    as_account("operator.testnet", 0);
    contract.report_address(id(account), EVIDENCE.into(), "drains approvals".into());
}

fn report_with(contract: &mut Contract, evidence_uri: &str, reason: &str) {
    as_account("operator.testnet", 0);
    contract.report_address(id("phish.testnet"), evidence_uri.into(), reason.into());
}

fn account(i: u32) -> String {
    format!("phish{i}.testnet")
}

#[test]
fn operator_reports_an_account_with_its_evidence() {
    let mut contract = init();
    report(&mut contract, "phish.testnet");
    let expected = Report {
        account_id: id("phish.testnet"),
        reported_at_ms: BLOCK_TIME_NS / 1_000_000,
        evidence_uri: EVIDENCE.into(),
        reason: "drains approvals".into(),
        reporter: id("operator.testnet"),
    };
    assert!(contract.is_reported(id("phish.testnet")));
    assert_eq!(contract.get_report(id("phish.testnet")), Some(expected.clone()));
    assert_eq!(event("address_reported")["data"][0], serde_json::to_value(&expected).unwrap());
    assert_eq!(contract.get_report_count(), 1);
}

#[test]
fn unknown_accounts_are_not_reported() {
    let contract = init();
    assert!(!contract.is_reported(id("nobody.testnet")));
    assert_eq!(contract.get_report(id("nobody.testnet")), None);
    assert!(contract.get_reports(None, None).is_empty());
    assert_eq!(contract.get_report_count(), 0);
}

#[test]
#[should_panic(expected = "ERR_NOT_OPERATOR")]
fn owner_cannot_report() {
    let mut contract = init();
    as_account("owner.testnet", 0);
    contract.report_address(id("phish.testnet"), EVIDENCE.into(), "x".into());
}

#[test]
#[should_panic(expected = "ERR_NOT_OPERATOR")]
fn anyone_else_cannot_report() {
    let mut contract = init();
    as_account("alice.testnet", 0);
    contract.report_address(id("phish.testnet"), EVIDENCE.into(), "x".into());
}

#[test]
#[should_panic(expected = "ERR_ALREADY_REPORTED")]
fn an_account_is_reported_once() {
    let mut contract = init();
    report(&mut contract, "phish.testnet");
    report(&mut contract, "phish.testnet");
}

#[test]
fn evidence_must_be_an_https_uri_of_at_most_2000_bytes() {
    let longest = format!("https://e.example/{}", "a".repeat(2000 - 18));
    assert_eq!(longest.len(), 2000);
    report_with(&mut init(), &longest, "ok");
    for bad in ["http://e.example/1", "https://", "https://a b", "ftp://e.example", &format!("{longest}a")] {
        let refused = std::panic::catch_unwind(|| report_with(&mut init(), bad, "ok"));
        assert!(refused.is_err(), "{bad}");
    }
}

#[test]
#[should_panic(expected = "ERR_EVIDENCE_URI")]
fn plain_http_evidence_is_refused() {
    report_with(&mut init(), "http://e.example/1", "ok");
}

#[test]
fn reason_is_1_to_280_characters_without_control_characters() {
    report_with(&mut init(), EVIDENCE, &"é".repeat(280));
    for bad in [String::new(), "   ".into(), "a".repeat(281), "line\nforged".into(), "tab\there".into()] {
        let refused = std::panic::catch_unwind(|| report_with(&mut init(), EVIDENCE, &bad));
        assert!(refused.is_err(), "{bad:?}");
    }
}

#[test]
#[should_panic(expected = "ERR_REASON")]
fn an_overlong_reason_is_refused() {
    report_with(&mut init(), EVIDENCE, &"a".repeat(281));
}

#[test]
fn owner_retracts_a_report_and_it_can_be_filed_again() {
    let mut contract = init();
    report(&mut contract, "phish.testnet");
    as_account("owner.testnet", 0);
    contract.retract_report(id("phish.testnet"));
    assert!(!contract.is_reported(id("phish.testnet")));
    assert_eq!(contract.get_report(id("phish.testnet")), None);
    let retracted = event("report_retracted");
    assert_eq!(retracted["data"][0]["by"], "owner.testnet");
    assert_eq!(retracted["data"][0]["report"]["evidence_uri"], EVIDENCE);
    // Removing the record gives its bytes back to the storage stake (written at flush, as the
    // runtime does when the call's state is saved).
    contract.flush();
    assert!(env::storage_usage() < STORAGE_BYTES);
    report(&mut contract, "phish.testnet");
    assert!(contract.is_reported(id("phish.testnet")));
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn operator_cannot_retract() {
    let mut contract = init();
    report(&mut contract, "phish.testnet");
    as_account("operator.testnet", 0);
    contract.retract_report(id("phish.testnet"));
}

#[test]
#[should_panic(expected = "ERR_NOT_REPORTED")]
fn retracting_an_unreported_account_fails() {
    let mut contract = init();
    as_account("owner.testnet", 0);
    contract.retract_report(id("nobody.testnet"));
}

#[test]
fn reports_are_paginated_and_capped() {
    let mut contract = init();
    for i in 0..55 {
        report(&mut contract, &account(i));
    }
    assert_eq!(contract.get_report_count(), 55);
    assert_eq!(contract.get_reports(None, None).len(), 20);
    assert_eq!(contract.get_reports(None, Some(1000)).len(), 50);
    let tail: Vec<_> = contract.get_reports(Some(50), Some(10)).into_iter().map(|r| r.account_id.to_string()).collect();
    assert_eq!(tail, (50..55).map(account).collect::<Vec<_>>());
    assert!(contract.get_reports(Some(u32::MAX), Some(u32::MAX)).is_empty());
}

#[test]
fn paging_after_a_retraction_still_lists_every_report_once() {
    let mut contract = init();
    for i in 0..30 {
        report(&mut contract, &account(i));
    }
    as_account("owner.testnet", 0);
    contract.retract_report(id(&account(3)));
    let mut seen: Vec<String> = [contract.get_reports(Some(0), Some(20)), contract.get_reports(Some(20), Some(20))]
        .concat()
        .into_iter()
        .map(|r| r.account_id.to_string())
        .collect();
    seen.sort();
    let mut expected: Vec<String> = (0..30).filter(|&i| i != 3).map(account).collect();
    expected.sort();
    assert_eq!(seen, expected);
}

#[test]
#[should_panic(expected = "ERR_RESERVE")]
fn a_report_cannot_eat_into_locked_deposits() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    // The balance is exactly the storage stake plus alice's locked deposit: the report's bytes
    // would have to come out of that deposit.
    let mut operator = context("operator.testnet", 0);
    testing_env!(operator.account_balance(NearToken::from_yoctonear(STAKE + PRICE)).build());
    contract.report_address(id("phish.testnet"), EVIDENCE.into(), "x".into());
}

#[test]
fn report_storage_comes_out_of_the_withdrawable_balance() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, None);
    // No reserve beyond the stake: everything above it is alice's earned deposit.
    let mut operator = context("operator.testnet", 0);
    testing_env!(operator.account_balance(NearToken::from_yoctonear(STAKE + PRICE)).build());
    assert_eq!(contract.get_withdrawable(), U128(PRICE));
    contract.report_address(id("phish.testnet"), EVIDENCE.into(), "x".into());
    let added = u128::from(env::storage_usage() - STORAGE_BYTES);
    assert!(added > 0);
    assert_eq!(contract.get_withdrawable(), U128(PRICE - added * env::storage_byte_cost().as_yoctonear()));
    assert_eq!(contract.get_earned(), U128(PRICE));
    assert_eq!(contract.get_config().locked, U128(0));
}
