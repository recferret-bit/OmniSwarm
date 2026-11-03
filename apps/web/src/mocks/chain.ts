// Dev/e2e only. The mock chain side: payments the mock wallet "sends", and the
// attestation the mock operator writes when a request reaches `done`. The
// attested hash is digestReport over the mock report files, so the app's
// verification path (RPC view + recompute) runs unchanged against it.
import { digestReport } from '@omniswarm/schemas/canonical-json';
import { b58encode } from '@omniswarm/schemas/nep413';
import findings from '../../public/sample/findings-and-scores.json';
import general from '../../public/sample/general-review.json';
import { clock, randomBytes, readState, updateState, type MockRequest, type MockTx } from './db';
import { snapshotAt } from './state-machine';

export const REPORTS_ORIGIN = 'https://reports.omniswarm.mock';

export function reportBase(id: string): string {
  return `${REPORTS_ORIGIN}/${id}/`;
}

export function reportFiles(tampered: boolean): { findings: unknown; general: unknown } {
  if (!tampered) return { findings, general };
  const [first, ...rest] = findings.findings;
  return { findings: { findings: [{ ...first, severity: 'low', title: `${first?.title} (edited after attestation)` }, ...rest] }, general };
}

export function newTxHash(): string {
  return b58encode(randomBytes(32));
}

export function recordPayment(tx: MockTx): string {
  const hash = newTxHash();
  updateState((state) => { state.txs[hash] = tx; });
  return hash;
}

// Writes the attestation (once) and the refund tx for terminal requests.
export async function settle(request: MockRequest): Promise<MockRequest> {
  const status = snapshotAt(request, clock.now()).status;
  if (status === 'done' && !readState().attestations[request.requestHash]) {
    const original = reportFiles(false);
    const reportSha256 = await digestReport(original.findings, original.general);
    updateState((state) => {
      state.attestations[request.requestHash] = {
        request_hash: request.requestHash, repo: request.repo, commit: request.commit,
        report_sha256: reportSha256, report_uri: `${reportBase(request.id)}index.json`,
        deployed: null, code_hash: null, max_severity: 'high', block_height: 1,
      };
      const row = state.requests.find((item) => item.id === request.id);
      if (row) row.attestTx = newTxHash();
    });
  }
  if (status === 'refunded' && !request.refundTx) {
    updateState((state) => {
      const row = state.requests.find((item) => item.id === request.id);
      if (row) row.refundTx = newTxHash();
    });
  }
  return readState().requests.find((item) => item.id === request.id) ?? request;
}
