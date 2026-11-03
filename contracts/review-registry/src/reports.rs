//! Abuse reports: the shared blocklist the agent guard reads through `is_reported`.
//!
//! The API queues reports, the owner reviews them, and the worker records approved ones with the
//! operator key. Only the owner retracts. A report's storage is carried by the contract's free
//! balance under the solvency rule in `money.rs`: it raises the storage stake, so it lowers
//! `get_withdrawable`, and `report_address` fails with `ERR_RESERVE` rather than eat into
//! `locked` deposits. Retracting frees the storage again.

use near_sdk::store::IterableMap;
use near_sdk::{env, near, AccountId};

use crate::events::{emit, RetractEvent};
use crate::validate::{page_limit, require_evidence_uri, require_reason};
use crate::{Contract, ContractExt};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub account_id: AccountId,
    /// Block time of the `report_address` call.
    pub reported_at_ms: u64,
    pub evidence_uri: String,
    pub reason: String,
    /// The operator account that recorded the report.
    pub reporter: AccountId,
}

pub(crate) type Reports = IterableMap<AccountId, Report>;

#[near]
impl Contract {
    /// Operator. Records an owner-approved report. One report per account: retract first to replace it.
    pub fn report_address(&mut self, account_id: AccountId, evidence_uri: String, reason: String) {
        self.only_operator();
        require_evidence_uri(&evidence_uri);
        require_reason(&reason);
        if self.reports.contains_key(&account_id) {
            env::panic_str("ERR_ALREADY_REPORTED");
        }
        let report = Report {
            account_id: account_id.clone(),
            reported_at_ms: env::block_timestamp_ms(),
            evidence_uri,
            reason,
            reporter: env::predecessor_account_id(),
        };
        self.reports.insert(account_id, report.clone());
        self.flush();
        self.assert_solvent();
        emit("address_reported", &report);
    }

    /// Owner. Removes the report and frees its storage.
    pub fn retract_report(&mut self, account_id: AccountId) {
        self.only_owner();
        let report = self.reports.remove(&account_id).unwrap_or_else(|| env::panic_str("ERR_NOT_REPORTED"));
        emit("report_retracted", &RetractEvent { by: &env::predecessor_account_id(), report: &report });
    }

    pub fn is_reported(&self, account_id: AccountId) -> bool {
        self.reports.contains_key(&account_id)
    }

    pub fn get_report(&self, account_id: AccountId) -> Option<Report> {
        self.reports.get(&account_id).cloned()
    }

    /// `from_index` defaults to 0, `limit` to 20 (at most 50). A retraction moves the last report
    /// into the freed slot, so the order is stable only between changes.
    pub fn get_reports(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Report> {
        let start = from_index.unwrap_or(0) as usize;
        self.reports.values().skip(start).take(page_limit(limit) as usize).cloned().collect()
    }

    pub fn get_report_count(&self) -> u32 {
        self.reports.len()
    }
}
