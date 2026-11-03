import { KeyPair } from "near-api-js";

export function account(secret: string) {
  localStorage.setItem("near-secret", secret);
  return KeyPair.fromString(secret);
}

export function remember(accountId: string) {
  sessionStorage.setItem("near-account", accountId);
  return accountId;
}
