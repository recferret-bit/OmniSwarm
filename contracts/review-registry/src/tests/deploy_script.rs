//! Runs `scripts/deploy-testnet.sh --dry-run` and checks the printed commands against the contract.

use std::process::{Command, Output};

use crate::OPERATOR_METHODS;
use near_sdk::serde_json;

const SCRIPT: &str = "scripts/deploy-testnet.sh";
const SOURCES: [&str; 3] = [include_str!("../review.rs"), include_str!("../money.rs"), include_str!("../reports.rs")];

fn run(args: &[&str], owner: &str) -> Output {
    Command::new("bash")
        .arg(SCRIPT)
        .args(args)
        .env("OWNER", owner)
        .env_remove("CONTRACT")
        .env_remove("OPERATOR")
        .env_remove("TREASURY")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("bash runs")
}

/// Splits one printed line back into argv the way a POSIX shell would: spaces separate words,
/// `'...'` is literal, and `\x` outside quotes is `x`.
fn argv(line: &str) -> Vec<String> {
    let mut words = vec![String::new()];
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        let word = words.last_mut().unwrap();
        match c {
            '\'' => word.extend(chars.by_ref().take_while(|&q| q != '\'')),
            '\\' => word.extend(chars.next()),
            ' ' => words.push(String::new()),
            _ => word.push(c),
        }
    }
    words
}

#[test]
fn printed_lines_survive_a_shell_round_trip() {
    let out = Command::new("bash")
        .args(["-c", "eval \"set -- $(bash scripts/deploy-testnet.sh --dry-run | sed -n 4p)\"; printf '%s\\n' \"$@\""])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .env("OWNER", "owner.testnet")
        .output()
        .unwrap();
    let words: Vec<String> = String::from_utf8(out.stdout).unwrap().lines().map(String::from).collect();
    assert_eq!(words, commands()[3]);
}

fn commands() -> Vec<Vec<String>> {
    let out = run(&["--dry-run"], "owner.testnet");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap().lines().map(argv).collect()
}

fn value_after(command: &[String], flag: &str) -> String {
    let at = command.iter().position(|w| w == flag).unwrap_or_else(|| panic!("{flag} missing"));
    command[at + 1].clone()
}

fn find<'a>(commands: &'a [Vec<String>], prefix: &[&str]) -> &'a Vec<String> {
    commands.iter().find(|c| c.iter().zip(prefix).all(|(a, b)| a == b)).unwrap_or_else(|| panic!("no {prefix:?}"))
}

#[test]
fn dry_run_prints_build_accounts_deploy_key_and_check() {
    let commands = commands();
    assert_eq!(commands.len(), 8);
    assert_eq!(commands[0][..4], ["cargo", "near", "build", "reproducible-wasm"]);
    assert_eq!(commands[1][0], "cp");
    assert!(commands[1].iter().any(|word| word.ends_with("res/review_registry.wasm")));
    assert_eq!(commands[2][..2], ["shasum", "-a"]);
    let text = commands.concat().join(" ");
    for forbidden in ["print-to-terminal", "sponsor-by", "reviewer_attest", "withdraw", "retract_report"] {
        assert!(!text.contains(forbidden), "{forbidden}");
    }
}

#[test]
fn the_function_call_key_lands_on_the_operator_named_in_new() {
    let commands = commands();
    let add_key = find(&commands, &["near", "account", "add-key"]);
    let deploy = find(&commands, &["near", "contract", "deploy"]);
    let init: serde_json::Value = serde_json::from_str(&value_after(deploy, "json-args")).unwrap();
    assert_eq!(add_key[3], "operator.owner.testnet");
    assert_eq!(init["operator"], add_key[3].as_str());
    assert_eq!(value_after(add_key, "--contract-account-id"), deploy[3]);
    assert_eq!(deploy[3], "review-registry.owner.testnet");
    assert_eq!(init["owner"], "owner.testnet");
    assert_eq!(init["price_yocto"], "1000000000000000000000000");
    let operator_created = find(&commands, &["near", "account", "create-account", "fund-myself", "operator.owner.testnet"]);
    assert_eq!(value_after(operator_created, "sign-as"), "owner.testnet");
}

#[test]
fn the_key_grants_exactly_the_operator_methods_and_they_exist() {
    let commands = commands();
    let add_key = find(&commands, &["near", "account", "add-key"]);
    assert_eq!(value_after(add_key, "--function-names"), OPERATOR_METHODS.join(", "));
    for method in OPERATOR_METHODS {
        let signature = format!("pub fn {method}(");
        assert!(SOURCES.iter().any(|source| source.contains(&signature)), "{method} is not a contract method");
    }
}

#[test]
fn without_a_mode_flag_it_refuses() {
    assert_eq!(run(&[], "owner.testnet").status.code(), Some(2));
}

#[test]
fn an_unsafe_account_id_is_refused() {
    let out = run(&["--dry-run"], "owner.testnet;touch x");
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
}
