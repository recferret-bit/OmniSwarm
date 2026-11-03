use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Escrow {
    owner: AccountId,
    arbiter: AccountId,
    balance: u128,
    released: bool,
}

#[near]
impl Escrow {
    #[init]
    pub fn new(owner: AccountId, arbiter: AccountId) -> Self {
        Self { owner, arbiter, balance: 0, released: false }
    }

    #[payable]
    pub fn deposit(&mut self) {
        let caller = env::predecessor_account_id();
        assert_eq!(caller, self.owner, "only the owner deposits");
        self.balance += env::attached_deposit().as_yoctonear();
    }

    pub fn withdraw(&mut self, amount: u128) -> Promise {
        self.balance = self.balance.saturating_sub(amount);
        Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(amount))
    }

    pub fn release(&mut self) -> Promise {
        assert_eq!(env::predecessor_account_id(), self.arbiter, "only the arbiter releases");
        require!(!self.released, "already released");
        self.released = true;
        let amount = self.balance;
        self.balance = 0;
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount))
    }

    pub fn balance(&self) -> u128 {
        self.balance
    }
}
