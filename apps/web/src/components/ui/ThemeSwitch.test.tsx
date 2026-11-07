import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ThemeSwitch } from './ThemeSwitch';

describe('ThemeSwitch', () => {
  it('writes the day theme onto the document', async () => {
    render(<ThemeSwitch />);
    await userEvent.click(screen.getByRole('button', { name: 'Night' }));
    expect(document.documentElement.dataset.theme).toBe('day');
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
  });
});
