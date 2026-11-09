import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HowItWorks } from './HowItWorks';

describe('How it works', () => {
  it('describes the four stages, including what the hash attests', () => {
    render(<HowItWorks />);
    expect(screen.getByRole('heading', { level: 2, name: 'Four stages, then a hash' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Independent reviewers/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('img', { name: 'Animated picture of independent review' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/Two reviewers by default, up to six/);
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/A hit stays a lead until a reviewer cites the line/);
    expect(screen.getByText(/two reviewers by default, up to six, on one sealed snapshot/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Attested on NEAR/ })).toBeInTheDocument();
  });
});
