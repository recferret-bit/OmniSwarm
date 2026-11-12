'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { messageFor } from '@/lib/api/errors';
import { env } from '@/lib/env';
import { getConnector, normalizeWalletError, type WalletConnector } from '@/lib/near/connector';
import { buildDonationTx, DONATION_TIERS, formatUsdc, toUsdcUnits } from '@/lib/near/donation';
import { txUrl } from '@/lib/near/explorer';
import { selectAccountId, useWallet } from '@/stores/wallet';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { QrCode } from '../ui/QrCode';
import { WalletSlot } from '../wallet/WalletSlot';
import './donate.css';

export const NATIVE_ONLY = 'Send native USDC on NEAR only — not USDC.e or another network.';
const CUSTOM = 'custom';
/** What a donation pays for. One line, shown under the heading on the landing band and on the dashboard footer. */
export const SUPPORT_LEDE = 'Servers, sandbox runners, storage, the domain and coffee for the maintainers. Always optional, never unlocks anything, in USDC on NEAR.';

export interface DonateProps {
  /** Recipient account. Defaults to NEXT_PUBLIC_DONATION_ACCOUNT; null renders nothing. */
  account?: string | null;
  /** Native USDC contract. Defaults to the network's (or the override); null keeps only the manual address. */
  usdcContract?: string | null;
  /** `section`: the landing band. `footer`: the block at the foot of the operator dashboard. Both are centered. */
  variant?: 'section' | 'footer';
  connector?: () => Promise<WalletConnector>;
}

type Outcome = { kind: 'sent'; txHash: string; amount: string } | { kind: 'error'; message: string } | null;

function CopyAccount({ account }: { account: string }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account);
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  };
  return (
    <>
      <Button variant="secondary" onClick={() => void copy()} aria-label={`Copy ${account}`}>{copied === 'yes' ? 'Copied' : 'Copy'}</Button>
      {copied === 'no' ? <span className="muted" role="status">Copy did not work here. Select the address instead.</span> : null}
    </>
  );
}

function DonateBody({ account, usdcContract, connector }: { account: string; usdcContract: string | null; connector: () => Promise<WalletConnector> }) {
  const legendId = useId();
  const accountId = useWallet(selectAccountId);
  const connected = useWallet((state) => state.status === 'connected' && state.accountId !== null);
  const [choice, setChoice] = useState<string>(DONATION_TIERS[0]!.amount);
  const [custom, setCustom] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const amount = choice === CUSTOM ? custom : choice;
  const units = toUsdcUnits(amount);
  const amountError = choice === CUSTOM && touched && !units ? 'Enter an amount above 0 with at most 2 decimals, for example 10 or 2.50.' : null;

  const donate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (!units || !usdcContract || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const wallet = await connector();
      const { txHash } = await wallet.signAndSendTransaction(buildDonationTx({ usdcContract, recipient: account, units }));
      setOutcome({ kind: 'sent', txHash, amount: formatUsdc(units) });
    } catch (caught) {
      const error = normalizeWalletError(caught);
      setOutcome({
        kind: 'error',
        message: error.code === 'WALLET_REJECTED' ? 'Donation cancelled in wallet. Nothing was sent.' : error.message || messageFor(error.code),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="donate">
      <form className="quote-form donate__form" onSubmit={(event) => void donate(event)} noValidate>
        <fieldset className="choice donate__tiers">
          <legend className="field__label">Amount</legend>
          {DONATION_TIERS.map((tier) => (
            <label key={tier.amount} className="choice__option">
              <input type="radio" name={`${legendId}-amount`} value={tier.amount} checked={choice === tier.amount} onChange={() => setChoice(tier.amount)} />
              <span className="choice__copy">
                <strong>{tier.amount} USDC · {tier.label}</strong>
                <span className="muted">{tier.note}</span>
              </span>
            </label>
          ))}
          <label className="choice__option">
            <input type="radio" name={`${legendId}-amount`} value={CUSTOM} checked={choice === CUSTOM} onChange={() => setChoice(CUSTOM)} />
            <span className="choice__copy">
              <strong>Custom amount</strong>
              <span className="muted">Any amount in USDC.</span>
            </span>
          </label>
        </fieldset>
        {choice === CUSTOM ? (
          <Field
            label="Amount in USDC"
            name="donation-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="10"
            value={custom}
            onChange={(event) => { setCustom(event.target.value); setTouched(true); }}
            error={amountError}
          />
        ) : null}
        {usdcContract ? (
          <div className="donate__wallet">
            <WalletSlot />
            <Button type="submit" busy={busy} disabled={!connected || !units}>
              {units ? `Donate ${formatUsdc(units)} USDC` : 'Donate'}
            </Button>
            {!connected ? <p className="muted">Connect a NEAR wallet to send it from here, or use the address below.</p> : null}
            {connected && accountId ? <p className="muted">Sent from {accountId}. The wallet asks you to confirm, and 1 yoctoNEAR is attached as NEP-141 requires.</p> : null}
          </div>
        ) : (
          <p className="muted">Wallet donations are not set up on this network. Send USDC to the address below.</p>
        )}
      </form>
      {outcome?.kind === 'sent' ? (
        <Alert tone="info">
          Thank you. {outcome.amount} USDC transfer sent. <a href={txUrl(outcome.txHash)} target="_blank" rel="noreferrer">View the transaction</a>
        </Alert>
      ) : null}
      {outcome?.kind === 'error' ? <Alert>{outcome.message}</Alert> : null}
      <div className="donate__manual">
        <p className="field__label">Or send from any wallet</p>
        <div className="donate__qr">
          <QrCode value={account} label={`QR code of the donation account ${account}`} />
          <p className="muted">Scan to copy the account into your wallet.</p>
        </div>
        <dl className="donate__facts">
          <dt>Recipient</dt>
          <dd className="donate__account">
            <code data-testid="donation-account">{account}</code>
            <CopyAccount account={account} />
          </dd>
          {usdcContract ? (
            <>
              <dt>Token</dt>
              <dd><span>Native USDC</span> <code className="donate__contract">{usdcContract}</code></dd>
            </>
          ) : null}
        </dl>
        {/* A standing warning, not an event: same look as a warn Alert, without role="alert". */}
        <div className="alert alert--warn"><p className="alert__text"><strong>{NATIVE_ONLY}</strong></p></div>
      </div>
    </div>
  );
}

/** Optional USDC donation. Renders nothing until a donation account is configured, and never gates anything. */
export function Donate({
  account = env.donationAccount,
  usdcContract = env.donationUsdcContract,
  variant = 'section',
  connector = getConnector,
}: DonateProps): ReactNode {
  if (!account) return null;
  const body = <DonateBody account={account} usdcContract={usdcContract} connector={connector} />;
  if (variant === 'footer') {
    return (
      <aside className="donate-footer" id="support" aria-labelledby="support-title">
        <h2 id="support-title" className="panel__title">Support OmniSwarm</h2>
        <p className="muted">{SUPPORT_LEDE}</p>
        {body}
      </aside>
    );
  }
  return (
    <section className="land-section" id="support" aria-labelledby="support-title">
      <div className="container-wide">
        <header className="land-head">
          <p className="land-kicker"><i>08</i><span className="eyebrow">Support</span></p>
          <h2 id="support-title" className="h2">Keep OmniSwarm free</h2>
          <p className="lede">{SUPPORT_LEDE}</p>
        </header>
        {body}
      </div>
    </section>
  );
}
