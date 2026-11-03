//! Read-only views.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::validate::page_limit;
use crate::{Attestation, Contract, ContractExt, Request};

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub owner: AccountId,
    pub pending_owner: Option<AccountId>,
    pub operator: AccountId,
    pub treasury: AccountId,
    pub price: U128,
    pub earned: U128,
    pub locked: U128,
}

#[near]
impl Contract {
    pub fn get_request(&self, request_hash: String) -> Option<Request> {
        self.requests.get(&request_hash).cloned()
    }

    /// Any attestation, confirmed or not. Check `binding_confirmed` before trusting `deployed`.
    pub fn get_attestation(&self, request_hash: String) -> Option<Attestation> {
        self.attestations.get(&request_hash).cloned()
    }

    /// The latest attestation whose `deployed` binding is confirmed. This is the guard's view.
    pub fn get_attestation_for_account(&self, account: AccountId) -> Option<Attestation> {
        self.by_account
            .get(&account)
            .and_then(|hash| self.attestations.get(hash))
            .filter(|attestation| attestation.binding_confirmed)
            .cloned()
    }

    /// Oldest first. `from_index` defaults to 0, `limit` to 20 (at most 50).
    pub fn get_attestations_for_repo(&self, repo: String, from_index: Option<u32>, limit: Option<u32>) -> Vec<Attestation> {
        let count = self.get_repo_attestation_count(repo.clone());
        let start = from_index.unwrap_or(0).min(count);
        let end = start.saturating_add(page_limit(limit)).min(count);
        (start..end)
            .filter_map(|index| self.repo_entries.get(&(repo.clone(), index)))
            .filter_map(|hash| self.attestations.get(hash).cloned())
            .collect()
    }

    pub fn get_repo_attestation_count(&self, repo: String) -> u32 {
        self.repo_count.get(&repo).copied().unwrap_or(0)
    }

    pub fn get_earned(&self) -> U128 {
        U128(self.earned)
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            pending_owner: self.pending_owner.clone(),
            operator: self.operator.clone(),
            treasury: self.treasury.clone(),
            price: U128(self.price),
            earned: U128(self.earned),
            locked: U128(self.locked),
        }
    }
}
