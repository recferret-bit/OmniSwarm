//! Request lifecycle: pay, run, attest, and the deployed-account binding.

use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId};

use crate::events::{emit, BindingEvent, RequestEvent};
use crate::validate::*;
use crate::{Attestation, Contract, ContractExt, Request, Status};

#[near]
impl Contract {
    /// Pays for one review. The deposit must reach the price and cover the storage of the
    /// record it creates (INTAKE §6: storage is paid from the deposit).
    #[payable]
    pub fn request_review(&mut self, request_hash: String) {
        require_hash(&request_hash);
        if self.requests.contains_key(&request_hash) {
            env::panic_str("ERR_HASH_USED");
        }
        let deposit = env::attached_deposit().as_yoctonear();
        if deposit < self.price {
            env::panic_str("ERR_DEPOSIT_LOW");
        }
        let account = env::predecessor_account_id();
        let request = Request { account, deposit: U128(deposit), block_height: env::block_height(), status: Status::Pending };
        let before = env::storage_usage();
        self.requests.insert(request_hash.clone(), request.clone());
        self.flush();
        let added = u128::from(env::storage_usage().saturating_sub(before));
        if deposit < added * env::storage_byte_cost().as_yoctonear() {
            env::panic_str("ERR_STORAGE_COST");
        }
        self.locked = self.locked.checked_add(deposit).unwrap_or_else(|| env::panic_str("ERR_OVERFLOW"));
        self.assert_solvent();
        emit("review_requested", &request_event(&request_hash, &request));
    }

    pub fn mark_running(&mut self, request_hash: String) {
        self.only_operator();
        let mut request = self.take(&request_hash);
        if request.status != Status::Pending {
            env::panic_str("ERR_BAD_STATUS");
        }
        request.status = Status::Running;
        self.requests.insert(request_hash.clone(), request.clone());
        emit("review_running", &request_event(&request_hash, &request));
    }

    /// Argument list is the INTAKE §6 shape the API codes against; see INTERFACE.md.
    #[allow(clippy::too_many_arguments)]
    pub fn attest(
        &mut self,
        request_hash: String,
        repo: String,
        commit: String,
        report_sha256: String,
        report_uri: String,
        deployed: Option<AccountId>,
        code_hash: Option<String>,
        max_severity: String,
    ) {
        self.only_operator();
        require_repo(&repo);
        require_commit(&commit);
        require_report_sha256(&report_sha256);
        require_report_uri(&report_uri);
        require_deployment(&deployed, &code_hash);
        require_severity(&max_severity);
        let mut request = self.take(&request_hash);
        if !request.status.is_open() {
            env::panic_str("ERR_BAD_STATUS");
        }
        request.status = Status::Done;
        self.locked -= request.deposit.0;
        self.earned = self.earned.checked_add(request.deposit.0).unwrap_or_else(|| env::panic_str("ERR_OVERFLOW"));
        let binding_confirmed = deployed.as_ref() == Some(&request.account);
        let attestation = Attestation {
            request_hash: request_hash.clone(),
            repo,
            commit,
            report_sha256,
            report_uri,
            deployed,
            code_hash,
            max_severity,
            block_height: env::block_height(),
            binding_confirmed,
        };
        self.requests.insert(request_hash.clone(), request);
        self.push_repo_entry(&attestation.repo, &request_hash);
        if binding_confirmed {
            self.bind(&attestation);
        }
        self.attestations.insert(request_hash, attestation.clone());
        self.flush();
        self.assert_solvent();
        emit("review_attested", &attestation);
    }

    /// Called by the `deployed` account itself to prove it controls the account the
    /// attestation names. Until then the guard's account lookup does not see it.
    pub fn confirm_binding(&mut self, request_hash: String) {
        require_hash(&request_hash);
        let mut attestation = self.attestations.get(&request_hash).cloned().unwrap_or_else(|| env::panic_str("ERR_NOT_FOUND"));
        let deployed = attestation.deployed.clone().unwrap_or_else(|| env::panic_str("ERR_NO_DEPLOYED"));
        if env::predecessor_account_id() != deployed {
            env::panic_str("ERR_NOT_DEPLOYED_ACCOUNT");
        }
        if attestation.binding_confirmed {
            env::panic_str("ERR_ALREADY_CONFIRMED");
        }
        attestation.binding_confirmed = true;
        self.bind(&attestation);
        self.attestations.insert(request_hash.clone(), attestation.clone());
        emit(
            "binding_confirmed",
            &BindingEvent {
                request_hash: &request_hash,
                deployed: &deployed,
                repo: &attestation.repo,
                commit: &attestation.commit,
                code_hash: attestation.code_hash.as_deref(),
            },
        );
    }
}

impl Contract {
    /// Points `deployed` at this attestation unless a newer confirmed one is already there.
    fn bind(&mut self, attestation: &Attestation) {
        let Some(account) = attestation.deployed.clone() else { return };
        let newer = self
            .by_account
            .get(&account)
            .and_then(|hash| self.attestations.get(hash))
            .is_some_and(|current| current.block_height > attestation.block_height);
        if !newer {
            self.by_account.insert(account, attestation.request_hash.clone());
        }
    }

    fn push_repo_entry(&mut self, repo: &str, request_hash: &str) {
        let index = self.repo_count.get(repo).copied().unwrap_or(0);
        self.repo_entries.insert((repo.to_string(), index), request_hash.to_string());
        self.repo_count.insert(repo.to_string(), index + 1);
    }
}

fn request_event<'a>(request_hash: &'a str, request: &'a Request) -> RequestEvent<'a> {
    RequestEvent { request_hash, account: &request.account, deposit: request.deposit, status: request.status }
}
