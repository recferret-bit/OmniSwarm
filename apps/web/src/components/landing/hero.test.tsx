import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HERO, Hero } from './Hero';

describe('Hero', () => {
  it('keeps the attested headline and the sample link', () => {
    render(<Hero />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(HERO);
    expect(screen.getByRole('link', { name: 'View a sample report' })).toHaveAttribute('href', '/sample');
    expect(screen.getByRole('link', { name: 'Review a repo' })).toHaveAttribute('href', '#review');
  });
});
