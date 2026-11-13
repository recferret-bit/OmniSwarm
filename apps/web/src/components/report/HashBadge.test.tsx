import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HashBadge } from './HashBadge';
import type { VerificationState } from './useVerification';

const report = { findings: {}, general: {}, computed: 'a'.repeat(64) };
const done = (result: object): VerificationState => ({ phase: 'done', result: { ...report, ...result } as never });

describe('HashBadge', () => {
  it('says the hash matches and shows both hashes', () => {
    render(<HashBadge state={done({ state: 'match', expected: 'a'.repeat(64) })} />);
    expect(screen.getByText('Report hash matches')).toBeTruthy();
    expect(screen.getByTestId('report-hash').textContent).toBe('a'.repeat(64));
    expect(screen.getByTestId('served-hash').textContent).toBe('a'.repeat(64));
  });

  it('says the hash does not match', () => {
    render(<HashBadge state={done({ state: 'mismatch', expected: 'b'.repeat(64) })} />);
    expect(screen.getByText('Report hash does not match')).toBeTruthy();
  });

  it('says there is nothing to compare when no hash was served', () => {
    render(<HashBadge state={done({ state: 'unhashed' })} />);
    expect(screen.getByText('No published hash to compare with')).toBeTruthy();
    expect(screen.getByTestId('served-hash').textContent).toBe('none');
  });

  it('shows the check running and its failure', () => {
    const { rerender } = render(<HashBadge state={{ phase: 'checking' }} />);
    expect(screen.getByText('Checking the report hash…')).toBeTruthy();
    rerender(<HashBadge state={{ phase: 'error', message: 'offline' }} />);
    expect(screen.getByText('Could not check the report: offline')).toBeTruthy();
  });

  it('labels a sample', () => {
    render(<HashBadge sample state={done({ state: 'match', expected: 'a'.repeat(64) })} />);
    expect(screen.getByText('Recorded sample hash')).toBeTruthy();
  });
});
