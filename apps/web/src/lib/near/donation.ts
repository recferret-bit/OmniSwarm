// Optional USDC donation: a NEP-141 `ft_transfer` on the native USDC contract.
// Nothing in the app depends on it; it never gates a review. Amounts are kept as
// strings end to end so no float ever touches a token amount.
import type { WalletTransaction } from './payment';

export const USDC_DECIMALS = 6;
export const DONATION_GAS = '30000000000000';
// NEP-141 requires exactly one yoctoNEAR on ft_transfer (a full-access confirmation).
export const DONATION_DEPOSIT = '1';
export const DONATION_MEMO = 'OmniSwarm donation';

export interface DonationTier {
  amount: string;
  label: string;
  note: string;
}

export const DONATION_TIERS: readonly DonationTier[] = [
  { amount: '5', label: 'Buy us a coffee', note: 'Keeps the maintainers going.' },
  { amount: '25', label: 'A day of infrastructure', note: 'Servers, storage and the domain for a day.' },
  { amount: '100', label: 'A month of a sandbox runner', note: 'One offline review runner for a month.' },
];

const AMOUNT = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/;

export type DonationArgs = { receiver_id: string; amount: string; memo: string };
export type DonationTransaction = WalletTransaction<DonationArgs>;

/**
 * A UI amount in USDC ("5", "0.5", "12.34") as integer base units (6 decimals), or null when it is not a
 * positive amount with at most 2 decimals. String math only.
 */
export function toUsdcUnits(input: string): string | null {
  const text = input.trim();
  const match = AMOUNT.exec(text);
  if (!match) return null;
  const whole = match[1]!;
  const fraction = (match[2] ?? '').slice(1).padEnd(USDC_DECIMALS, '0');
  const units = `${whole}${fraction}`.replace(/^0+/, '');
  return units === '' ? null : units;
}

/** Base units back to a display amount ("5000000" -> "5", "500000" -> "0.5"). */
export function formatUsdc(units: string): string {
  const padded = units.padStart(USDC_DECIMALS + 1, '0');
  const whole = padded.slice(0, -USDC_DECIMALS).replace(/^0+(?=\d)/, '');
  const fraction = padded.slice(-USDC_DECIMALS).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export function buildDonationTx(input: { usdcContract: string; recipient: string; units: string }): DonationTransaction {
  if (!/^[1-9][0-9]*$/.test(input.units)) throw new Error('donation amount must be positive integer base units');
  return {
    receiverId: input.usdcContract,
    actions: [{
      type: 'FunctionCall',
      params: {
        methodName: 'ft_transfer',
        args: { receiver_id: input.recipient, amount: input.units, memo: DONATION_MEMO },
        gas: DONATION_GAS,
        deposit: DONATION_DEPOSIT,
      },
    }],
  };
}
