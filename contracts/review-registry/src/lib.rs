//! OmniSwarm review registry: a paid, single-use review request, its attestation, the
//! deployed-account binding, and the abuse-report blocklist the agent guard reads. The public interface is in INTERFACE.md.

mod admin;
mod events;
mod money;
mod reports;
mod review;
mod validate;
mod views;

#[cfg(test)]
mod tests;

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, BorshStorageKey, PanicOnDefault};

pub use reports::Report;
pub use validate::{OPERATOR_METHODS, SEVERITIES};

/// Storage prefixes. Append new variants at the end: the borsh index is the on-chain prefix.
#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Requests,
    Attestations,
    ByAccount,
    RepoCount,
    RepoEntries,
    Reports,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Pending,
    Running,
    Done,
    Refunded,
}

impl Status {
    /// Pending and Running hold a deposit that is neither earned nor refunded yet.
    pub fn is_open(self) -> bool {
        matches!(self, Status::Pending | Status::Running)
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    pub account: AccountId,
    pub deposit: U128,
    pub block_height: u64,
    pub status: Status,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Attestation {
    pub request_hash: String,
    pub repo: String,
    pub commit: String,
    pub report_sha256: String,
    pub report_uri: String,
    pub deployed: Option<AccountId>,
    pub code_hash: Option<String>,
    pub max_severity: String,
    pub block_height: u64,
    /// Block time of the attest call, so freshness needs no archival block lookup.
    pub block_timestamp_ms: u64,
    /// True only when the `deployed` account itself proved control: it paid the request,
    /// or it called `confirm_binding`. `get_attestation_for_account` returns only these.
    pub binding_confirmed: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    pending_owner: Option<AccountId>,
    operator: AccountId,
    treasury: AccountId,
    price: u128,
    /// Deposits of `Done` requests not yet withdrawn.
    earned: u128,
    /// Deposits of `Pending` and `Running` requests. Never withdrawable.
    locked: u128,
    requests: LookupMap<String, Request>,
    attestations: LookupMap<String, Attestation>,
    by_account: LookupMap<AccountId, String>,
    repo_count: LookupMap<String, u32>,
    repo_entries: LookupMap<(String, u32), String>,
    reports: reports::Reports,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, operator: AccountId, treasury: AccountId, price_yocto: U128) -> Self {
        Self {
            owner,
            pending_owner: None,
            operator,
            treasury,
            price: price_yocto.0,
            earned: 0,
            locked: 0,
            requests: LookupMap::new(Key::Requests),
            attestations: LookupMap::new(Key::Attestations),
            by_account: LookupMap::new(Key::ByAccount),
            repo_count: LookupMap::new(Key::RepoCount),
            repo_entries: LookupMap::new(Key::RepoEntries),
            reports: reports::Reports::new(Key::Reports),
        }
    }
}

impl Contract {
    pub(crate) fn only_owner(&self) {
        if env::predecessor_account_id() != self.owner {
            env::panic_str("ERR_NOT_OWNER");
        }
    }

    pub(crate) fn only_operator(&self) {
        if env::predecessor_account_id() != self.operator {
            env::panic_str("ERR_NOT_OPERATOR");
        }
    }

    pub(crate) fn take(&self, hash: &str) -> Request {
        validate::require_hash(hash);
        self.requests.get(hash).cloned().unwrap_or_else(|| env::panic_str("ERR_NOT_FOUND"))
    }

    /// Writes cached collection entries so `env::storage_usage()` reflects them.
    pub(crate) fn flush(&mut self) {
        self.requests.flush();
        self.attestations.flush();
        self.by_account.flush();
        self.repo_count.flush();
        self.repo_entries.flush();
        self.reports.flush();
    }
}
