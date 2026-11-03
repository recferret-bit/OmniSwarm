use super::*;

fn hash(i: u32) -> String {
    format!("{i:064x}")
}

#[test]
fn views_return_none_or_empty_for_unknown_keys() {
    let contract = init();
    assert_eq!(contract.get_request(HASH.to_string()), None);
    assert_eq!(contract.get_attestation(HASH.to_string()), None);
    assert_eq!(contract.get_attestation_for_account(id("nobody.testnet")), None);
    assert!(contract.get_attestations_for_repo("a/b".into(), None, None).is_empty());
    assert_eq!(contract.get_repo_attestation_count("a/b".into()), 0);
    assert_eq!(contract.get_earned(), U128(0));
    assert_eq!(contract.get_withdrawable(), U128(0));
}

#[test]
fn repo_attestations_are_paginated_and_capped() {
    let mut contract = init();
    for i in 0..55 {
        pay(&mut contract, "alice.testnet", &hash(i), PRICE);
        attest_as_operator(&mut contract, &hash(i), None);
    }
    let repo = || "near/near-sdk-rs".to_string();
    assert_eq!(contract.get_repo_attestation_count(repo()), 55);
    assert_eq!(contract.get_attestations_for_repo(repo(), None, None).len(), 20);
    assert_eq!(contract.get_attestations_for_repo(repo(), None, Some(1000)).len(), 50);
    let tail = contract.get_attestations_for_repo(repo(), Some(50), Some(10));
    let hashes: Vec<_> = tail.iter().map(|a| a.request_hash.clone()).collect();
    assert_eq!(hashes, (50..55).map(hash).collect::<Vec<_>>());
    assert!(contract.get_attestations_for_repo(repo(), Some(u32::MAX), Some(u32::MAX)).is_empty());
}

#[test]
fn get_attestation_for_account_returns_the_latest_confirmed() {
    let mut contract = init();
    pay(&mut contract, "dex.testnet", HASH, PRICE);
    attest_as_operator(&mut contract, HASH, Some("dex.testnet"));
    pay(&mut contract, "dex.testnet", HASH2, PRICE);
    let mut later = context("operator.testnet", 0);
    testing_env!(later.block_height(30).build());
    attest_with(&mut contract, HASH2, AttestArgs::new(Some("dex.testnet")));
    assert_eq!(contract.get_attestation_for_account(id("dex.testnet")).unwrap().request_hash, HASH2);
}
