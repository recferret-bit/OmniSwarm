//! Each `attest` argument rule rejects a bad value with its own error code.

use super::*;

fn attest_mutated(mutate: impl FnOnce(&mut AttestArgs)) {
    let mut contract = init();
    pay(&mut contract, "alice.testnet", HASH, PRICE);
    let mut args = AttestArgs::new(Some("dex.testnet"));
    mutate(&mut args);
    as_account("operator.testnet", 0);
    attest_with(&mut contract, HASH, args);
}

#[test]
fn valid_arguments_pass() {
    attest_mutated(|_| {});
}

#[test]
#[should_panic(expected = "ERR_REPO_FORMAT")]
fn repo_needs_owner_and_name() {
    attest_mutated(|a| a.repo = "no-slash".into());
}

#[test]
#[should_panic(expected = "ERR_REPO_FORMAT")]
fn repo_owner_is_at_most_39_chars() {
    attest_mutated(|a| a.repo = format!("{}/x", "o".repeat(40)));
}

#[test]
#[should_panic(expected = "ERR_REPO_FORMAT")]
fn repo_rejects_extra_path() {
    attest_mutated(|a| a.repo = "a/b/c".into());
}

#[test]
#[should_panic(expected = "ERR_COMMIT_FORMAT")]
fn commit_is_40_lower_hex() {
    attest_mutated(|a| a.commit = "C".repeat(40));
}

#[test]
#[should_panic(expected = "ERR_REPORT_SHA256")]
fn report_sha256_is_64_lower_hex() {
    attest_mutated(|a| a.report_sha256 = "z".repeat(64));
}

#[test]
#[should_panic(expected = "ERR_REPORT_URI")]
fn report_uri_must_be_https() {
    attest_mutated(|a| a.report_uri = "http://reports.example/1".into());
}

#[test]
#[should_panic(expected = "ERR_REPORT_URI")]
fn report_uri_rejects_javascript_scheme() {
    attest_mutated(|a| a.report_uri = "javascript:alert(1)".into());
}

#[test]
#[should_panic(expected = "ERR_REPORT_URI")]
fn report_uri_rejects_whitespace() {
    attest_mutated(|a| a.report_uri = "https://reports.example/a b".into());
}

#[test]
#[should_panic(expected = "ERR_REPORT_URI")]
fn report_uri_is_at_most_2000_bytes() {
    attest_mutated(|a| a.report_uri = format!("https://{}", "a".repeat(1993)));
}

#[test]
#[should_panic(expected = "ERR_SEVERITY")]
fn severity_is_from_the_schema_enum() {
    attest_mutated(|a| a.max_severity = "HIGH".into());
}

#[test]
#[should_panic(expected = "ERR_CODE_HASH")]
fn code_hash_is_base58() {
    attest_mutated(|a| a.code_hash = Some("0OIl".repeat(10)));
}

#[test]
#[should_panic(expected = "ERR_DEPLOYED_PAIR")]
fn deployed_needs_a_code_hash() {
    attest_mutated(|a| a.code_hash = None);
}

#[test]
#[should_panic(expected = "ERR_DEPLOYED_PAIR")]
fn code_hash_needs_deployed() {
    attest_mutated(|a| a.deployed = None);
}

#[test]
fn every_schema_severity_is_accepted() {
    let mut contract = init();
    for (i, severity) in crate::SEVERITIES.iter().enumerate() {
        let hash = format!("{i:064x}");
        pay(&mut contract, "alice.testnet", &hash, PRICE);
        let mut args = AttestArgs::new(None);
        args.max_severity = severity.to_string();
        as_account("operator.testnet", 0);
        attest_with(&mut contract, &hash, args);
        assert_eq!(contract.get_attestation(hash).unwrap().max_severity, *severity);
    }
}
