use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseResult};

const CALLBACK_GAS: Gas = Gas::from_tgas(5);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TipJar {
    owner: AccountId,
    fee_bps: u128,
    paused: bool,
    balances: LookupMap<AccountId, u128>,
    token_balances: LookupMap<AccountId, u128>,
    fees: u128,
}

#[near]
impl TipJar {
    #[init]
    pub fn new(owner: AccountId, fee_bps: u128) -> Self {
        Self {
            owner,
            fee_bps,
            paused: false,
            balances: LookupMap::new(b"b"),
            token_balances: LookupMap::new(b"b"),
            fees: 0,
        }
    }

    pub fn set_owner(&mut self, owner: AccountId) {
        self.owner = owner;
    }

    pub fn set_paused(&mut self, paused: bool) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        self.paused = paused;
    }

    pub fn set_fee(&mut self, fee_bps: u128) {
        require!(env::signer_account_id() == self.owner, "owner only");
        self.fee_bps = fee_bps;
    }

    #[payable]
    pub fn tip(&mut self, creator: AccountId) {
        require!(!self.paused, "paused");
        let amount = env::attached_deposit().as_yoctonear();
        let fee = amount * self.fee_bps / 10_000;
        self.fees += fee;
        let current = self.balances.get(&creator).unwrap_or(0);
        self.balances.insert(&creator, &(current + amount - fee));
    }

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let account = env::predecessor_account_id();
        let balance = self.balances.get(&account).unwrap_or(0);
        require!(balance >= amount.0, "insufficient balance");
        Promise::new(account.clone())
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_withdraw(account, amount))
    }

    pub fn on_withdraw(&mut self, account: AccountId, amount: U128) {
        if let PromiseResult::Successful(_) = env::promise_result(0) {
            let balance = self.balances.get(&account).unwrap_or(0);
            self.balances.insert(&account, &(balance - amount.0));
        }
    }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let creator: AccountId = msg.parse().unwrap();
        let current = self.token_balances.get(&creator).unwrap_or(0);
        self.token_balances.insert(&creator, &(current + amount.0));
        env::log_str(&format!("token tip from {sender_id}"));
        U128(0)
    }

    #[payable]
    pub fn collect_fees(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "owner only");
        let fees = self.fees;
        self.fees = 0;
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(fees))
    }

    pub fn balance_of(&self, account: AccountId) -> U128 {
        U128(self.balances.get(&account).unwrap_or(0))
    }
}
