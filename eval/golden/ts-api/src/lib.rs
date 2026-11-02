use near_sdk::env;

pub struct Escrow {
    owner: String,
    balance: u128,
}

impl Escrow {
    pub fn deposit(&mut self) {
        let caller = env::predecessor_account_id().to_string();
        assert_eq!(caller, self.owner);
        self.balance += 1;
    }

    pub fn withdraw(&mut self, amount: u128) {
        self.balance = self.balance.saturating_sub(amount);
    }
}
