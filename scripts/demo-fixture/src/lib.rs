use near_sdk::env;
use near_sdk::json_types::U128;
use near_sdk::near;

#[near(contract_state)]
#[derive(Default)]
pub struct Vault {
    owner: String,
    balance: u128,
}

#[near]
impl Vault {
    #[init]
    pub fn new(owner: String) -> Self {
        Self { owner, balance: 0 }
    }

    pub fn get_owner(&self) -> String {
        self.owner.clone()
    }

    pub fn deposit(&mut self) {
        let caller = env::predecessor_account_id().to_string();
        assert_eq!(caller, self.owner);
        self.balance = self.balance.saturating_add(env::attached_deposit().as_yoctonear());
    }

    pub fn withdraw(&mut self, amount: u128) {
        let next = self.balance.saturating_sub(amount);
        self.balance = next;
    }

    pub fn transfer(&mut self, to: String, amount: u128) {
        let caller = env::predecessor_account_id().to_string();
        assert_eq!(caller, self.owner);
        self.balance = self.balance.saturating_sub(amount);
        let _ = to;
    }

    pub fn ft_on_transfer(&mut self, sender_id: String, amount: U128) -> U128 {
        self.balance = self.balance.saturating_add(amount.0);
        let _ = sender_id;
        U128(0)
    }

    pub fn ft_resolve_transfer(&mut self, sender_id: String, amount: U128) -> U128 {
        let caller = env::predecessor_account_id().to_string();
        assert_eq!(caller, self.owner);
        let refund = amount.0.min(self.balance);
        self.balance -= refund;
        let _ = sender_id;
        U128(refund)
    }
}
