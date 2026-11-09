import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { Receipt, nearLabel, type ReceiptBody } from './Receipt';
import { receiptMatch } from './ReceiptSection';

const HASH = 'b'.repeat(64);
const YOCTO = '1000000000000000000000000';

const fixture: ReceiptBody = {
  paid: { yocto: YOCTO, tx: 'PayTx1111111111111111111111111111111111111111' },
  reviewers: [{ id: 'key-zai-glm-5-3', vendor: 'zai', model: 'glm-5.3', calls: 4, tokens: 1800, usd: 0.02 }],
  check: { passed: 2, total: 3, byStatus: { CONFIRMED: 1, REFUTED: 1, DISPUTED: 1 } },
  attestation: { tx: 'AttestTx11111111111111111111111111111111111111', hash: HASH, match: true },
};

describe('receipt', () => {
  it('renders the fixture: paid, reviewers, the check, match, and no refund', async () => {
    const { container } = render(<Receipt receipt={fixture} match />);
    expect(nearLabel(YOCTO)).toBe('1 NEAR');
    expect(screen.getByRole('heading', { name: 'Receipt' })).toBeInTheDocument();
    expect(screen.getByText(/1 NEAR/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'payment transaction' })).toHaveAttribute(
      'href', 'https://explorer.mock.invalid/txns/PayTx1111111111111111111111111111111111111111',
    );
    expect(screen.getByRole('cell', { name: 'glm-5.3' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'zai' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '4' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '1800' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '$0.02' })).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByText(HASH)).toBeInTheDocument();
    expect(screen.getByText('match')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'attestation transaction' })).toHaveAttribute(
      'href', 'https://explorer.mock.invalid/txns/AttestTx11111111111111111111111111111111111111',
    );
    expect(screen.getByText('none')).toBeInTheDocument();
    const result = await axe.run(container);
    expect(result.violations).toEqual([]);
  });

  it('a published report with no request hash is not left checking, and does not keep the API match', () => {
    expect(receiptMatch({ reportUrl: 'https://reports.example/r/report.html', requestHash: null, phase: 'checking', verifyState: 'match' })).toBe('unavailable');
    expect(receiptMatch({ reportUrl: 'https://reports.example/r/report.html', requestHash: 'a'.repeat(64), phase: 'done', verifyState: 'unattested' })).toBe('unavailable');
    expect(receiptMatch({ reportUrl: 'https://reports.example/r/report.html', requestHash: 'a'.repeat(64), phase: 'done', verifyState: 'match' })).toBe(true);
    expect(receiptMatch({ requestHash: null, phase: 'idle' })).toBeUndefined();
    render(<Receipt receipt={{ ...fixture, attestation: { ...fixture.attestation!, match: true } }} match="unavailable" />);
    expect(screen.getByText('not verified in this browser')).toBeInTheDocument();
    expect(screen.queryByText('match')).not.toBeInTheDocument();
  });

  it('a refunded receipt names the refund and has no attestation', () => {
    render(<Receipt receipt={{
      paid: fixture.paid, reviewers: [], check: { passed: 0, total: 0, byStatus: {} },
      refund: { tx: 'RefundTx111', yocto: YOCTO },
    }} />);
    expect(screen.getByRole('link', { name: 'refund transaction' })).toHaveAttribute(
      'href', 'https://explorer.mock.invalid/txns/RefundTx111',
    );
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(screen.queryByText('match')).not.toBeInTheDocument();
  });
});
