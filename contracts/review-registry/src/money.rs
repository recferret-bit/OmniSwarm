//! Refunds, withdrawals and the solvency rule.
//!
//! Invariant: `account_balance >= storage_usage * storage_byte_cost + locked`. Every state
//! change that grows storage or `locked` asserts it, and `withdraw` never takes the balance
//! below it, so pending deposits and the storage stake stay backed.

use near_sdk::json_types::U128;
use near_sdk::{env, near, Gas, NearToken, Promise};

use crate::events::{emit, RequestEvent, WithdrawEvent};
use crate::{Contract, ContractExt, Status};

const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near]
impl Contract {
    /// Operator or owner. Returns the transfer promise; `on_refund_done` restores the request
    /// to its previous status if the transfer fails.
    pub fn refund(&mut self, request_hash: String) -> Promise {
        let caller = env::predecessor_account_id();
        if caller != self.operator && caller != self.owner {
            env::panic_str("ERR_NOT_OPERATOR");
        }
        let mut request = self.take(&request_hash);
        if !request.status.is_open() {
            env::panic_str("ERR_BAD_STATUS");
        }
        let previous = request.status;
        request.status = Status::Refunded;
        self.locked -= request.deposit.0;
        self.requests.insert(request_hash.clone(), request.clone());
        emit("review_refunded", &RequestEvent { request_hash: &request_hash, account: &request.account, deposit: request.deposit, status: previous });
        Promise::new(request.account)
            .transfer(NearToken::from_yoctonear(request.deposit.0))
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_refund_done(request_hash, previous))
    }

    #[private]
    pub fn on_refund_done(&mut self, request_hash: String, previous: Status) -> bool {
        if transfer_succeeded() {
            return true;
        }
        let mut request = self.take(&request_hash);
        request.status = previous;
        self.locked += request.deposit.0;
        self.requests.insert(request_hash.clone(), request.clone());
        emit("refund_failed", &RequestEvent { request_hash: &request_hash, account: &request.account, deposit: request.deposit, status: previous });
        false
    }

    /// Owner. Sends earned deposits to the treasury, never more than `get_withdrawable`.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        self.only_owner();
        if amount.0 == 0 {
            env::panic_str("ERR_ZERO_AMOUNT");
        }
        if amount.0 > self.earned {
            env::panic_str("ERR_INSUFFICIENT_EARNED");
        }
        if amount.0 > self.free_balance() {
            env::panic_str("ERR_RESERVE");
        }
        self.earned -= amount.0;
        let treasury = self.treasury.clone();
        emit("withdrawn", &WithdrawEvent { treasury: &treasury, amount });
        Promise::new(treasury.clone())
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_withdraw_done(treasury, amount))
    }

    #[private]
    pub fn on_withdraw_done(&mut self, treasury: near_sdk::AccountId, amount: U128) -> bool {
        if transfer_succeeded() {
            return true;
        }
        self.earned += amount.0;
        emit("withdraw_failed", &WithdrawEvent { treasury: &treasury, amount });
        false
    }

    /// `min(earned, balance - storage stake - locked)`.
    pub fn get_withdrawable(&self) -> U128 {
        U128(self.earned.min(self.free_balance()))
    }
}

impl Contract {
    pub(crate) fn free_balance(&self) -> u128 {
        env::account_balance().as_yoctonear().saturating_sub(storage_stake()).saturating_sub(self.locked)
    }

    pub(crate) fn assert_solvent(&self) {
        let needed = storage_stake().checked_add(self.locked).unwrap_or_else(|| env::panic_str("ERR_OVERFLOW"));
        if env::account_balance().as_yoctonear() < needed {
            env::panic_str("ERR_RESERVE");
        }
    }
}

fn storage_stake() -> u128 {
    u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear()
}

/// A transfer returns no value, so a successful result is an empty buffer.
fn transfer_succeeded() -> bool {
    env::promise_results_count() == 1 && env::promise_result_checked(0, 0).is_ok()
}
