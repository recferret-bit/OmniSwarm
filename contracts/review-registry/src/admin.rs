//! Owner methods: price, operator, treasury, and two-step owner rotation.

use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId};

use crate::events::{emit, AdminEvent};
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    pub fn get_price(&self) -> U128 {
        U128(self.price)
    }

    pub fn set_price(&mut self, price_yocto: U128) {
        self.only_owner();
        let old = std::mem::replace(&mut self.price, price_yocto.0);
        self.admin_event("price_set", old.to_string(), self.price.to_string());
    }

    pub fn set_operator(&mut self, operator: AccountId) {
        self.only_owner();
        let old = std::mem::replace(&mut self.operator, operator);
        self.admin_event("operator_set", old.to_string(), self.operator.to_string());
    }

    pub fn set_treasury(&mut self, treasury: AccountId) {
        self.only_owner();
        let old = std::mem::replace(&mut self.treasury, treasury);
        self.admin_event("treasury_set", old.to_string(), self.treasury.to_string());
    }

    /// Step one of an owner rotation. A later proposal replaces an earlier one;
    /// proposing the current owner cancels it.
    pub fn propose_owner(&mut self, new_owner: AccountId) {
        self.only_owner();
        let proposed = (new_owner != self.owner).then_some(new_owner);
        let shown = proposed.as_ref().map(AccountId::to_string).unwrap_or_default();
        self.pending_owner = proposed;
        self.admin_event("owner_proposed", self.owner.to_string(), shown);
    }

    /// Step two: only the proposed account can accept.
    pub fn accept_owner(&mut self) {
        let caller = env::predecessor_account_id();
        if self.pending_owner.as_ref() != Some(&caller) {
            env::panic_str("ERR_NOT_PENDING_OWNER");
        }
        self.pending_owner = None;
        let old = std::mem::replace(&mut self.owner, caller);
        self.admin_event("owner_accepted", old.to_string(), self.owner.to_string());
    }
}

impl Contract {
    fn admin_event(&self, event: &str, old: String, new: String) {
        emit(event, &AdminEvent { by: &env::predecessor_account_id(), old, new });
    }
}
