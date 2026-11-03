use super::*;

#[test]
fn pay_then_mark_and_attest() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE * 2);
    assert_eq!(status(&contract, HASH), Status::Pending);
    assert_eq!(contract.get_config().locked, U128(PRICE * 2));
    as_account("operator.testnet", 0);
    contract.mark_running(HASH.to_string());
    assert_eq!(status(&contract, HASH), Status::Running);
    attest_with(&mut contract, HASH, AttestArgs::new(None));
    assert_eq!(status(&contract, HASH), Status::Done);
    assert_eq!(contract.get_earned().0, PRICE * 2);
    assert_eq!(contract.get_config().locked, U128(0));
}

#[test]
#[should_panic(expected = "ERR_HASH_USED")]
fn hash_is_single_use() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    pay(&mut contract, "alice.testnet", HASH, PRICE);
}

#[test]
#[should_panic(expected = "ERR_DEPOSIT_LOW")]
fn underpayment_is_rejected() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE / 2);
}

#[test]
#[should_panic(expected = "ERR_HASH_FORMAT")]
fn uppercase_hash_is_rejected() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", &"A".repeat(64), PRICE);
}

#[test]
#[should_panic(expected = "ERR_HASH_FORMAT")]
fn short_hash_is_rejected() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", "abc", PRICE);
}

#[test]
#[should_panic(expected = "ERR_STORAGE_COST")]
fn deposit_must_cover_the_record_storage() {
    let mut contract = init();
    as_account("owner.testnet", 0);
    contract.set_price(U128(1));
    pay(&mut contract, "alice.testnet", HASH, 1);
}

#[test]
#[should_panic(expected = "ERR_NOT_OPERATOR")]
fn non_operator_cannot_mark_running() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    contract.mark_running(HASH.to_string());
}

#[test]
#[should_panic(expected = "ERR_BAD_STATUS")]
fn mark_running_twice_is_rejected() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    as_account("operator.testnet", 0);
    contract.mark_running(HASH.to_string());
    contract.mark_running(HASH.to_string());
}

#[test]
#[should_panic(expected = "ERR_NOT_OPERATOR")]
fn non_operator_cannot_attest() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_with(&mut contract, HASH, AttestArgs::new(None));
}

#[test]
#[should_panic(expected = "ERR_NOT_FOUND")]
fn attest_of_unknown_request_is_rejected() {
    let mut contract = init();
    attest_as_operator(&mut contract, HASH, None);
}

#[test]
#[should_panic(expected = "ERR_BAD_STATUS")]
fn attest_of_refunded_is_rejected() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    as_account("operator.testnet", 0);
    let _ = contract.refund(HASH.to_string());
    attest_with(&mut contract, HASH, AttestArgs::new(None));
}

#[test]
#[should_panic(expected = "ERR_BAD_STATUS")]
fn attest_twice_is_rejected() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, None);
    attest_as_operator(&mut contract, HASH, None);
}

#[test]
fn third_party_binding_is_not_visible_to_the_guard() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, Some("victim.testnet"));
    let stored = contract.get_attestation(HASH.to_string()).unwrap();
    assert!(!stored.binding_confirmed);
    assert_eq!(contract.get_attestation_for_account(id("victim.testnet")), None);
}

#[test]
fn requester_paying_as_the_deployed_account_binds_at_once() {
    let mut contract = init();
    pay(&mut contract, "dex.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, Some("dex.testnet"));
    let found = contract.get_attestation_for_account(id("dex.testnet")).unwrap();
    assert!(found.binding_confirmed);
    assert_eq!(found.code_hash.as_deref(), Some(CODE_HASH));
    assert_eq!(found.block_timestamp_ms, BLOCK_TIME_NS / 1_000_000);
}

#[test]
fn deployed_account_confirms_a_binding() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, Some("dex.testnet"));
    as_account("dex.testnet", 0);
    contract.confirm_binding(HASH.to_string());
    assert!(contract.get_attestation_for_account(id("dex.testnet")).unwrap().binding_confirmed);
    let data = &event("binding_confirmed")["data"][0];
    assert_eq!(data["deployed"], "dex.testnet");
    assert_eq!(data["code_hash"], CODE_HASH);
}

#[test]
#[should_panic(expected = "ERR_NOT_DEPLOYED_ACCOUNT")]
fn only_the_deployed_account_can_confirm() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, Some("dex.testnet"));
    as_account("alice.testnet", 0);
    contract.confirm_binding(HASH.to_string());
}

#[test]
#[should_panic(expected = "ERR_ALREADY_CONFIRMED")]
fn confirm_twice_is_rejected() {
    let mut contract = init();
    pay(&mut contract, "dex.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, Some("dex.testnet"));
    as_account("dex.testnet", 0);
    contract.confirm_binding(HASH.to_string());
}

#[test]
#[should_panic(expected = "ERR_NO_DEPLOYED")]
fn confirm_without_deployed_is_rejected() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, None);
    as_account("alice.testnet", 0);
    contract.confirm_binding(HASH.to_string());
}

#[test]
fn an_older_confirmation_does_not_replace_a_newer_binding() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, Some("dex.testnet"));
    pay(&mut contract, "dex.testnet", HASH2, PRICE);
    let mut later = context("operator.testnet", 0);
    testing_env!(later.block_height(20).build());
    attest_with(&mut contract, HASH2, AttestArgs::new(Some("dex.testnet")));
    as_account("dex.testnet", 0);
    contract.confirm_binding(HASH.to_string());
    assert_eq!(contract.get_attestation_for_account(id("dex.testnet")).unwrap().request_hash, HASH2);
}
