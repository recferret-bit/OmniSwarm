use near_sdk::collections::{LookupMap, LookupSet};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, CryptoHash, Gas, NearToken, PanicOnDefault, Promise, PromiseResult};

const CALLBACK_GAS: Gas = Gas::from_tgas(5);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TipJar {
    owner: AccountId,
    fee_bps: u128,
    paused: bool,
    balances: LookupMap<AccountId, u128>,
    token_balances: LookupMap<AccountId, u128>,
    used_nonces: LookupSet<u64>,
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
            used_nonces: LookupSet::new(b"n"),
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

    pub fn claim_voucher(&mut self, digest: [u8; 32], sig: [u8; 64], v: u8, amount: U128) {
        if let Some(_pk) = env::ecrecover(&digest, &sig, v, false) {
            let caller = env::predecessor_account_id();
            let current = self.balances.get(&caller).unwrap_or(0);
            self.balances.insert(&caller, &(current + amount.0));
        }
    }

    pub fn resume_settlement(&mut self, yield_id: CryptoHash, payload: Vec<u8>) -> bool {
        env::promise_yield_resume(&yield_id, &payload)
    }

    pub fn mt_resolve_deposit(&mut self, accounts: Vec<AccountId>, amount: U128) -> U128 {
        env::log_str(&format!("resolving deposit batch {accounts:?}"));
        amount
    }

    pub fn verify_signed_voucher(&mut self, digest: [u8; 32], sig: [u8; 64], v: u8, nonce: u64, expected_eth: [u8; 20]) -> bool {
        require!(!self.used_nonces.contains(&nonce), "nonce used");
        let Some(pk) = env::ecrecover(&digest, &sig, v, true) else { return false };
        let hash = env::keccak256(&pk);
        require!(hash[12..32] == expected_eth, "wrong signer");
        self.used_nonces.insert(&nonce);
        true
    }

    #[private]
    pub fn on_yield_settled(&mut self, account: AccountId, locked: U128) {
        if !matches!(env::promise_result_checked(0, 256), Ok(bytes) if bytes == b"ok") {
            let current = self.balances.get(&account).unwrap_or(0);
            self.balances.insert(&account, &current.saturating_add(locked.0));
        }
    }
}
