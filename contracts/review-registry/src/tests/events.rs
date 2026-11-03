use super::*;

fn assert_nep297(value: &serde_json::Value) {
    let object = value.as_object().unwrap();
    let mut keys: Vec<_> = object.keys().map(String::as_str).collect();
    keys.sort();
    assert_eq!(keys, ["data", "event", "standard", "version"]);
    assert_eq!(value["standard"], crate::events::STANDARD);
    assert_eq!(value["version"], crate::events::VERSION);
    assert!(value["data"].as_array().is_some_and(|data| data.len() == 1));
}

#[test]
fn every_log_is_a_parseable_nep297_event() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    let requested = event("review_requested");
    assert_nep297(&requested);
    let data = &requested["data"][0];
    assert_eq!(data["request_hash"], HASH);
    assert_eq!(data["account"], "alice.testnet");
    assert_eq!(data["deposit"], PRICE.to_string());
    assert_eq!(data["status"], "Pending");

    as_account("operator.testnet", 0);
    contract.mark_running(HASH.to_string());
    assert_nep297(&event("review_running"));
    attest_with(&mut contract, HASH, AttestArgs::new(Some("dex.testnet")));
    for value in events() {
        assert_nep297(&value);
    }
}

#[test]
fn review_attested_carries_the_full_attestation() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, Some("dex.testnet"));
    let data = &event("review_attested")["data"][0];
    let expected = serde_json::to_value(contract.get_attestation(HASH.to_string()).unwrap()).unwrap();
    assert_eq!(data, &expected);
    for field in ["report_sha256", "max_severity", "deployed", "code_hash", "binding_confirmed", "repo", "commit", "block_timestamp_ms"] {
        assert!(data.get(field).is_some(), "{field}");
    }
}

#[test]
fn withdraw_emits_an_event() {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, None);
    as_account("owner.testnet", 0);
    let _ = contract.withdraw(U128(PRICE));
    let withdrawn = event("withdrawn");
    assert_nep297(&withdrawn);
    assert_eq!(withdrawn["data"][0]["treasury"], "treasury.testnet");
}
