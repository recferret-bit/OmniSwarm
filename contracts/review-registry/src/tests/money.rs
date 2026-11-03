use super::*;

#[test]
#[should_panic(expected = "ERR_BAD_STATUS")]
fn refund_of_done_is_rejected() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, None);
    let _ = contract.refund(HASH.to_string());
}

#[test]
fn refund_of_pending_transfers_the_exact_deposit() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE * 2);
    as_account("operator.testnet", 0);
    let _ = contract.refund(HASH.to_string());
    assert_eq!(status(&contract, HASH), Status::Refunded);
    assert_eq!(transfers(), vec![(id("alice.testnet"), PRICE * 2)]);
    assert_eq!(callbacks(), vec!["on_refund_done".to_string()]);
    assert_eq!(event("review_refunded")["data"][0]["deposit"], (PRICE * 2).to_string());
    assert_eq!(contract.get_earned().0, 0);
    assert_eq!(contract.get_config().locked, U128(0));
}

#[test]
fn owner_can_refund_a_running_request() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    as_account("operator.testnet", 0);
    contract.mark_running(HASH.to_string());
    as_account("owner.testnet", 0);
    let _ = contract.refund(HASH.to_string());
    assert_eq!(status(&contract, HASH), Status::Refunded);
}

#[test]
#[should_panic(expected = "ERR_NOT_OPERATOR")]
fn requester_cannot_refund_itself() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    let _ = contract.refund(HASH.to_string());
}

#[test]
#[should_panic(expected = "ERR_BAD_STATUS")]
fn refund_twice_is_rejected() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    as_account("operator.testnet", 0);
    let _ = contract.refund(HASH.to_string());
    let _ = contract.refund(HASH.to_string());
}

#[test]
fn failed_refund_restores_the_previous_status_and_lock() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    as_account("operator.testnet", 0);
    contract.mark_running(HASH.to_string());
    let _ = contract.refund(HASH.to_string());
    as_callback(PromiseResult::Failed);
    assert!(!contract.on_refund_done(HASH.to_string(), Status::Running));
    assert_eq!(status(&contract, HASH), Status::Running);
    assert_eq!(contract.get_config().locked, U128(PRICE));
    assert_eq!(event("refund_failed")["data"][0]["status"], "Running");
}

#[test]
fn successful_refund_callback_changes_nothing() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    as_account("operator.testnet", 0);
    let _ = contract.refund(HASH.to_string());
    as_callback(PromiseResult::Successful(vec![]));
    assert!(contract.on_refund_done(HASH.to_string(), Status::Pending));
    assert_eq!(status(&contract, HASH), Status::Refunded);
    assert_eq!(contract.get_config().locked, U128(0));
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn withdraw_is_owner_only() {
    let mut contract = init();
    as_account("alice.testnet", 0);
    let _ = contract.withdraw(U128(1));
}

#[test]
#[should_panic(expected = "ERR_INSUFFICIENT_EARNED")]
fn pending_deposits_are_not_withdrawable() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    as_account("owner.testnet", 0);
    let _ = contract.withdraw(U128(PRICE));
}

#[test]
fn owner_withdraws_only_earned_to_the_treasury() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE * 2);
    attest_as_operator(&mut contract, HASH, None);
    as_account("owner.testnet", 0);
    let _ = contract.withdraw(U128(PRICE));
    assert_eq!(contract.get_earned().0, PRICE);
    assert_eq!(transfers(), vec![(id("treasury.testnet"), PRICE)]);
    assert_eq!(callbacks(), vec!["on_withdraw_done".to_string()]);
}

#[test]
#[should_panic(expected = "ERR_RESERVE")]
fn withdraw_cannot_touch_the_storage_stake_or_locked_deposits() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, None);
    pay(&mut contract, "bob.testnet", HASH2, PRICE);
    // Balance covers storage plus bob's locked deposit plus half of alice's earned deposit.
    let mut owner = context("owner.testnet", 0);
    testing_env!(owner.account_balance(NearToken::from_yoctonear(STAKE + PRICE + PRICE / 2)).build());
    assert_eq!(contract.get_withdrawable().0, PRICE / 2);
    let _ = contract.withdraw(U128(PRICE));
}

#[test]
fn failed_withdraw_restores_earned() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, None);
    as_account("owner.testnet", 0);
    let _ = contract.withdraw(U128(PRICE));
    as_callback(PromiseResult::Failed);
    assert!(!contract.on_withdraw_done(id("treasury.testnet"), U128(PRICE)));
    assert_eq!(contract.get_earned().0, PRICE);
    assert_eq!(event("withdraw_failed")["data"][0]["amount"], PRICE.to_string());
}

#[test]
#[should_panic(expected = "ERR_ZERO_AMOUNT")]
fn zero_withdraw_is_rejected() {
    let mut contract = init();
    as_account("owner.testnet", 0);
    let _ = contract.withdraw(U128(0));
}

#[test]
#[should_panic(expected = "ERR_RESERVE")]
fn request_is_rejected_when_the_contract_cannot_back_its_storage() {
    let mut contract = init();
    let mut alice = context("alice.testnet", PRICE);
    // Like the runtime, the mock credits the deposit: the balance becomes exactly the current
    // stake plus this deposit, so the new record's storage is unbacked.
    testing_env!(alice.account_balance(NearToken::from_yoctonear(STAKE)).build());
    contract.request_review(HASH.to_string());
}

#[test]
fn request_succeeds_when_the_contract_has_a_reserve() {
    let mut contract = init();
    let mut alice = context("alice.testnet", PRICE);
    testing_env!(alice.account_balance(NearToken::from_yoctonear(STAKE + ONE_NEAR / 100)).build());
    contract.request_review(HASH.to_string());
    assert_eq!(contract.get_config().locked, U128(PRICE));
}
