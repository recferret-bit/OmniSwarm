import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NearChecks } from './NearChecks';

describe('NEAR checks', () => {
  it('names the libraries and the skill, and does not mention Solana or Ethereum', () => {
    render(<NearChecks />);
    expect(screen.getByRole('heading', { level: 2, name: 'What the pipeline checks' })).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    for (const name of [
      'near-sdk',
      'near-sdk-js',
      'cargo-near 0.22.0',
      'near-api-js',
      '@hot-labs/near-connect',
      '@defuse-protocol/intents-sdk',
      '@neardefi/shade-agent-js',
      'engine/skills/security-audit/SKILL.md',
      '2147484061',
    ]) {
      expect(text).toContain(name);
    }
    expect(text).not.toMatch(/Solana|Ethereum|EVM|Solidity|Vyper|Anchor/);
  });
});
