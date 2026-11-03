import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OnChainAttestation } from '@/lib/near/rpc';
import { AttestationBadge } from './AttestationBadge';

const attestation = { request_hash: 'a'.repeat(64), report_sha256: 'b'.repeat(64) } as OnChainAttestation;
const done = (state: 'match' | 'mismatch', computed: string) => ({ phase: 'done' as const, result: { state, computed, attestation, findings: {}, general: {} } });

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
});
