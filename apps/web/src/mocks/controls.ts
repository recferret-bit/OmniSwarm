// Dev/e2e only. Mock error injection: `?mock=<CODE>` and `?wallet=reject` on any
// page URL, or the dev panel. Codes are listed in db.ts (MOCK_ERRORS).
import { MOCK_ERRORS, updateState, type MockError } from './db';

export function isMockError(value: string | null): value is MockError {
  return value !== null && (MOCK_ERRORS as readonly string[]).includes(value);
}

export function setMockError(code: MockError | null): void {
  updateState((state) => { state.controls.error = code; });
}

export function setWalletReject(reject: boolean): void {
  updateState((state) => { state.controls.walletReject = reject; });
}

export function setTampered(tampered: boolean): void {
  updateState((state) => { state.controls.tampered = tampered; });
}

export function applySearchParams(search: string): void {
  const params = new URLSearchParams(search);
  const mock = params.get('mock');
  if (mock === 'none') setMockError(null);
  else if (isMockError(mock)) setMockError(mock);
  if (params.get('wallet') === 'reject') setWalletReject(true);
}
