//! Argument checks. Patterns match packages/schemas/attestation.schema.json and INTAKE §5.

use near_sdk::{env, AccountId};

/// Methods the operator function-call key may call. `scripts/deploy-testnet.sh` grants exactly these.
pub const OPERATOR_METHODS: [&str; 4] = ["mark_running", "attest", "refund", "report_address"];

/// `max_severity` values, same enum as `attestation.schema.json`.
pub const SEVERITIES: [&str; 6] = ["critical", "high", "medium", "low", "info", "none"];

pub(crate) const MAX_URI: usize = 2000;
/// A report reason is at most 280 characters (Unicode scalar values, so at most 1120 bytes).
pub(crate) const MAX_REASON_CHARS: usize = 280;
pub(crate) const MAX_PAGE: u32 = 50;
pub(crate) const DEFAULT_PAGE: u32 = 20;
const BASE58: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

fn is_lower_hex(value: &str, len: usize) -> bool {
    value.len() == len && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn require(ok: bool, code: &str) {
    if !ok {
        env::panic_str(code);
    }
}

/// Request hashes are sha256 hex, lowercase.
pub(crate) fn require_hash(value: &str) {
    require(is_lower_hex(value, 64), "ERR_HASH_FORMAT");
}

pub(crate) fn require_report_sha256(value: &str) {
    require(is_lower_hex(value, 64), "ERR_REPORT_SHA256");
}

pub(crate) fn require_commit(value: &str) {
    require(is_lower_hex(value, 40), "ERR_COMMIT_FORMAT");
}

/// `owner/name` with GitHub's limits: owner `[A-Za-z0-9-]{1,39}`, name `[A-Za-z0-9._-]{1,100}`.
pub(crate) fn require_repo(value: &str) {
    let ok = match value.split_once('/') {
        Some((owner, name)) => {
            (1..=39).contains(&owner.len())
                && owner.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                && (1..=100).contains(&name.len())
                && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        }
        None => false,
    };
    require(ok, "ERR_REPO_FORMAT");
}

/// `https://` followed by at least one visible ASCII character, at most 2000 bytes in total.
fn is_https_uri(value: &str) -> bool {
    let rest = value.strip_prefix("https://").unwrap_or("");
    !rest.is_empty() && value.len() <= MAX_URI && rest.bytes().all(|b| b.is_ascii_graphic())
}

pub(crate) fn require_report_uri(value: &str) {
    require(is_https_uri(value), "ERR_REPORT_URI");
}

pub(crate) fn require_evidence_uri(value: &str) {
    require(is_https_uri(value), "ERR_EVIDENCE_URI");
}

/// Free text from an owner-reviewed report: 1 to 280 characters, not only whitespace, no
/// control characters (so no newlines that could forge log lines in a client).
pub(crate) fn require_reason(value: &str) {
    let ok = !value.trim().is_empty() && value.chars().count() <= MAX_REASON_CHARS && !value.chars().any(char::is_control);
    require(ok, "ERR_REASON");
}

pub(crate) fn require_severity(value: &str) {
    require(SEVERITIES.contains(&value), "ERR_SEVERITY");
}

/// `deployed` and `code_hash` come together: the guard compares the live hash with this one.
/// A NEAR code hash is base58 of 32 bytes (32 to 44 characters).
pub(crate) fn require_deployment(deployed: &Option<AccountId>, code_hash: &Option<String>) {
    match (deployed, code_hash) {
        (None, None) => {}
        (Some(_), Some(hash)) => {
            let ok = (32..=44).contains(&hash.len()) && hash.bytes().all(|b| BASE58.contains(&b));
            require(ok, "ERR_CODE_HASH");
        }
        _ => env::panic_str("ERR_DEPLOYED_PAIR"),
    }
}

/// `limit` defaults to 20 and is capped at 50.
pub(crate) fn page_limit(limit: Option<u32>) -> u32 {
    limit.unwrap_or(DEFAULT_PAGE).min(MAX_PAGE)
}
