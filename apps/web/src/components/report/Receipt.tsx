import { txUrl } from '@/lib/near/explorer';
import { Panel } from '../ui/Panel';
import { Pill } from '../ui/Pill';

export interface ReceiptBody {
  paid: { yocto: string; tx: string };
  reviewers: { id: string; vendor: string; model: string; calls: number; tokens: number; usd: number }[];
  check: { passed: number; total: number; byStatus: Record<string, number> };
  attestation?: { tx: string; hash: string; match?: boolean };
  refund?: { tx: string; yocto?: string };
}

const YOCTO = 10n ** 24n;

/** The stored yocto amount, shown in NEAR when it divides cleanly. */
export function nearLabel(yocto: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(yocto)) return yocto;
  const value = BigInt(yocto);
  const whole = value / YOCTO;
  const frac = (value % YOCTO).toString().padStart(24, '0').replace(/0+$/, '');
  return frac ? `${whole.toString()}.${frac} NEAR` : `${whole.toString()} NEAR`;
}

function usdLabel(usd: number): string {
  return `$${usd}`;
}

function TxLink({ hash, children }: { hash: string; children: string }) {
  return <a href={txUrl(hash)} target="_blank" rel="noreferrer">{children}</a>;
}

export function Receipt({ receipt, match }: { receipt: ReceiptBody; match?: boolean }) {
  const shown = match ?? receipt.attestation?.match;
  const statuses = Object.entries(receipt.check.byStatus);
  return (
    <Panel id="receipt" title="Receipt">
      <dl className="receipt">
        <dt>Paid</dt>
        <dd>{nearLabel(receipt.paid.yocto)} (<TxLink hash={receipt.paid.tx}>payment transaction</TxLink>)</dd>
        <dt>Findings that passed the check</dt>
        <dd>{receipt.check.passed} of {receipt.check.total}</dd>
        <dt>Attested hash</dt>
        <dd>
          {receipt.attestation
            ? <code>{receipt.attestation.hash}</code>
            : 'none'}
          {shown === true ? <> <Pill tone="good">match</Pill></> : null}
          {shown === false ? <> <Pill tone="bad">does not match</Pill></> : null}
          {receipt.attestation ? <> (<TxLink hash={receipt.attestation.tx}>attestation transaction</TxLink>)</> : null}
        </dd>
        <dt>Refund</dt>
        <dd>{receipt.refund ? <TxLink hash={receipt.refund.tx}>refund transaction</TxLink> : 'none'}</dd>
      </dl>
      <div className="table-scroll">
        <table>
          <caption>Reviewers hired for this request</caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Vendor</th>
              <th scope="col">Calls</th>
              <th scope="col">Tokens</th>
              <th scope="col">USD</th>
            </tr>
          </thead>
          <tbody>
            {receipt.reviewers.length ? receipt.reviewers.map((reviewer) => (
              <tr key={reviewer.id}>
                <td>{reviewer.model}</td>
                <td>{reviewer.vendor}</td>
                <td>{reviewer.calls}</td>
                <td>{reviewer.tokens}</td>
                <td>{usdLabel(reviewer.usd)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5}>No reviewer usage was stored with this request.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {statuses.length ? (
        <ul aria-label="Findings by status">
          {statuses.map(([status, count]) => <li key={status}>{status}: {count}</li>)}
        </ul>
      ) : null}
    </Panel>
  );
}
