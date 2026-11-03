use super::*;

#[test]
fn owner_sets_price_operator_and_treasury_with_events() {
    let mut contract = init();
    as_account("owner.testnet", 0);
    contract.set_price(U128(PRICE * 3));
    assert_eq!(contract.get_price(), U128(PRICE * 3));
    assert_eq!(event("price_set")["data"][0]["new"], (PRICE * 3).to_string());
    contract.set_operator(id("operator2.testnet"));
    assert_eq!(event("operator_set")["data"][0]["old"], "operator.testnet");
    contract.set_treasury(id("treasury2.testnet"));
    assert_eq!(event("treasury_set")["data"][0]["new"], "treasury2.testnet");
    let config = contract.get_config();
    assert_eq!(config.operator, id("operator2.testnet"));
    assert_eq!(config.treasury, id("treasury2.testnet"));
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn non_owner_cannot_set_price() {
    let mut contract = init();
    as_account("alice.testnet", 0);
    contract.set_price(U128(1));
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn non_owner_cannot_set_operator() {
    let mut contract = init();
    as_account("operator.testnet", 0);
    contract.set_operator(id("alice.testnet"));
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn non_owner_cannot_set_treasury() {
    let mut contract = init();
    as_account("alice.testnet", 0);
    contract.set_treasury(id("alice.testnet"));
}

#[test]
fn old_operator_loses_access_after_rotation() {
    let mut contract = init();
    as_account("owner.testnet", 0);
    contract.set_operator(id("operator2.testnet"));
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    as_account("operator2.testnet", 0);
    contract.mark_running(HASH.to_string());
    as_account("operator.testnet", 0);
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| contract.mark_running(HASH.to_string())));
    assert!(refused.is_err());
}

#[test]
fn owner_rotation_is_two_step() {
    let mut contract = init();
    as_account("owner.testnet", 0);
    contract.propose_owner(id("new-owner.testnet"));
    assert_eq!(contract.get_config().owner, id("owner.testnet"));
    assert_eq!(contract.get_config().pending_owner, Some(id("new-owner.testnet")));
    as_account("new-owner.testnet", 0);
    contract.accept_owner();
    assert_eq!(event("owner_accepted")["data"][0]["old"], "owner.testnet");
    let config = contract.get_config();
    assert_eq!(config.owner, id("new-owner.testnet"));
    assert_eq!(config.pending_owner, None);
    contract.set_price(U128(5));
    assert_eq!(contract.get_price(), U128(5));
}

#[test]
#[should_panic(expected = "ERR_NOT_PENDING_OWNER")]
fn only_the_proposed_account_accepts() {
    let mut contract = init();
    as_account("owner.testnet", 0);
    contract.propose_owner(id("new-owner.testnet"));
    as_account("alice.testnet", 0);
    contract.accept_owner();
}

#[test]
#[should_panic(expected = "ERR_NOT_PENDING_OWNER")]
fn proposing_the_current_owner_cancels() {
    let mut contract = init();
    as_account("owner.testnet", 0);
    contract.propose_owner(id("new-owner.testnet"));
    contract.propose_owner(id("owner.testnet"));
    assert_eq!(contract.get_config().pending_owner, None);
    as_account("new-owner.testnet", 0);
    contract.accept_owner();
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn non_owner_cannot_propose() {
    let mut contract = init();
    as_account("alice.testnet", 0);
    contract.propose_owner(id("alice.testnet"));
}
