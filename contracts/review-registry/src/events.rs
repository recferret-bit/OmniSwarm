//! NEP-297 events: `EVENT_JSON:{"standard","version","event","data":[...]}`.

use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{env, serde_json, AccountId};

use crate::Status;

pub const STANDARD: &str = "omniswarm";
pub const VERSION: &str = "1.1.0";

pub(crate) fn emit<T: Serialize>(event: &str, data: &T) {
    let body = serde_json::json!({
        "standard": STANDARD,
        "version": VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{body}"));
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub(crate) struct RequestEvent<'a> {
    pub request_hash: &'a str,
    pub account: &'a AccountId,
    pub deposit: U128,
    pub status: Status,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub(crate) struct BindingEvent<'a> {
    pub request_hash: &'a str,
    pub deployed: &'a AccountId,
    pub repo: &'a str,
    pub commit: &'a str,
    pub code_hash: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub(crate) struct WithdrawEvent<'a> {
    pub treasury: &'a AccountId,
    pub amount: U128,
}

/// Admin changes: `price_set`, `operator_set`, `treasury_set`, `owner_proposed`, `owner_accepted`.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub(crate) struct AdminEvent<'a> {
    pub by: &'a AccountId,
    pub old: String,
    pub new: String,
}
