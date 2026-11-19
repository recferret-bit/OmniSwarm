use near_sdk::collections::{LookupMap, LookupSet};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

const MPC_SIGNER: &str = "v1.signer";
const CKD_GAS: Gas = Gas::from_tgas(50);

#[near(serializers = [json])]
pub struct CKDRequestArgs {
    pub derivation_path: String,
    pub app_public_key: String,
    pub domain_id: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ShadeVault {
    owner: AccountId,
    approved_codehashes: LookupSet<String>,
    worker_codehash: LookupMap<AccountId, String>,
    order_payers: LookupMap<u64, AccountId>,
    internal_balances: LookupMap<AccountId, u128>,
}

#[near]
impl ShadeVault {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            approved_codehashes: LookupSet::new(b"c"),
            worker_codehash: LookupMap::new(b"w"),
            order_payers: LookupMap::new(b"o"),
            internal_balances: LookupMap::new(b"i"),
        }
    }

    pub fn register_worker(&mut self, quote_hex: String, codehash: String) {
        let _ = quote_hex;
        self.worker_codehash.insert(&env::predecessor_account_id(), &codehash);
    }

    pub fn request_app_private_key(&self, derivation_path: String, app_public_key: String) -> Promise {
        let args = CKDRequestArgs { derivation_path, app_public_key, domain_id: 2 };
        Promise::new(MPC_SIGNER.parse().unwrap()).function_call("request_app_private_key".into(), near_sdk::serde_json::to_vec(&args).unwrap(), NearToken::from_yoctonear(1), CKD_GAS)
    }

    pub fn reclaim_expired_order(&mut self, order_id: u64) -> Promise {
        let before = env::storage_usage();
        self.order_payers.remove(&order_id);
        let freed = u128::from(before.saturating_sub(env::storage_usage())) * env::storage_byte_cost().as_yoctonear();
        Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(freed))
    }

    pub fn credit_intent_deposit(&mut self, depositor: AccountId, notifier: AccountId, amount: U128) -> Promise {
        let bal = self.internal_balances.get(&depositor).unwrap_or(0);
        self.internal_balances.insert(&depositor, &(bal + amount.0));
        Promise::new(notifier).function_call("on_deposit_notified".into(), b"{}".to_vec(), NearToken::from_yoctonear(0), Gas::from_tgas(20))
    }

    pub fn execute_worker_action(&mut self, recipient: AccountId, amount: U128) {
        let caller = env::predecessor_account_id();
        let Some(ch) = self.worker_codehash.get(&caller) else { env::panic_str("unregistered worker") };
        require!(self.approved_codehashes.contains(&ch), "unapproved codehash");
        require!(amount.0 <= 1_000_000, "policy cap exceeded");
        let bal = self.internal_balances.get(&recipient).unwrap_or(0);
        self.internal_balances.insert(&recipient, &bal.saturating_add(amount.0));
    }

    #[private]
    pub fn on_mpc_sign(&mut self, account: AccountId, debited: U128) {
        if env::promise_result_checked(0, 512).is_err() {
            let bal = self.internal_balances.get(&account).unwrap_or(0);
            self.internal_balances.insert(&account, &bal.saturating_add(debited.0));
        }
    }
}
