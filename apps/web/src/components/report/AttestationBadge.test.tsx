import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OnChainAttestation } from '@/lib/near/rpc';
import { AttestationBadge } from './AttestationBadge';

const attestation: OnChainAttestation = {
  request_hash: 'a'.repeat(64), repo: 'o/r', commit: '0'.repeat(40), report_sha256: 'b'.repeat(64), report_uri: 'https://r.example/x/index.json',
  deployed: null, code_hash: null, max_severity: 'high', block_height: 1, block_timestamp_ms: 1792497600000, binding_confirmed: false,
};
const done = (state: 'match' | 'mismatch', computed: string, change: Partial<OnChainAttestation> = {}) =>
  ({ phase: 'done' as const, result: { state, computed, attestation: { ...attestation, ...change }, findings: {}, general: {} } });

describe('<AttestationBadge>', () => {
  it('green when the recomputed hash equals the on-chain one, with the attest tx link', () => {
    render(<AttestationBadge state={done('match', 'b'.repeat(64))} attestTx="TxHash111" />);
    expect(screen.getByRole('status')).toHaveTextContent('hash matches on-chain attestation');
    expect(screen.getByRole('link', { name: 'View the attest transaction' })).toHaveAttribute('href', 'https://explorer.mock.invalid/txns/TxHash111');
  });

  it('red on mismatch, showing both hashes', () => {
    render(<AttestationBadge state={done('mismatch', 'c'.repeat(64))} />);
    expect(screen.getByRole('status')).toHaveTextContent('hash does not match the attestation');
    expect(screen.getByTestId('report-hash')).toHaveTextContent('c'.repeat(64));
    expect(screen.getByTestId('attested-hash')).toHaveTextContent('b'.repeat(64));
  });

  it('a sample is labelled as a recorded fixture, never as on-chain', () => {
    render(<AttestationBadge state={done('match', 'b'.repeat(64))} sample attestTx="ignored" />);
    expect(screen.getByRole('status')).toHaveTextContent('Attested (sample)');
    expect(screen.getByText(/not read from NEAR/)).toBeInTheDocument();
    expect(screen.queryByText('hash matches on-chain attestation')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the API fallback label when the chain was not read', () => {
    const state = done('match', 'b'.repeat(64));
    render(<AttestationBadge state={{ phase: 'done', result: { ...state.result, label: 'via API, not independent' } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('via API, not independent');
  });

  it('shows whether the deployed-account binding is confirmed (contract v0.2)', () => {
    const { rerender } = render(<AttestationBadge state={done('match', 'b'.repeat(64))} />);
    expect(screen.getByTestId('binding-status')).toHaveTextContent('No deployed contract account is bound');
    rerender(<AttestationBadge state={done('match', 'b'.repeat(64), { deployed: 'dex.testnet', code_hash: 'h' })} />);
    expect(screen.getByTestId('binding-status')).toHaveTextContent(/Binding not confirmed.*dex\.testnet.*guard does not use/);
    rerender(<AttestationBadge state={done('match', 'b'.repeat(64), { deployed: 'dex.testnet', code_hash: 'h', binding_confirmed: true })} />);
    expect(screen.getByTestId('binding-status')).toHaveTextContent(/Binding confirmed.*dex\.testnet confirmed/);
  });
});
