import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ReportIndexResponse } from '@/lib/api/schema.gen';
import { ShareOnX } from './ShareOnX';

const INDEX = {
  requestId: '00000000-0000-4000-8000-000000000001',
  reportUrl: 'https://reports.omniswarm.example/r/1/report.html',
  repo: 'octo/app',
  maxSeverity: 'medium',
  check: { passed: 2, total: 4 },
} satisfies ReportIndexResponse;

describe('ShareOnX', () => {
  it('prefills the post and links to the X compose window with the report link', () => {
    render(<ShareOnX requestId="r1" index={INDEX} />);
    expect((screen.getByRole('textbox', { name: 'Post' }) as HTMLTextAreaElement).value).toContain('octo/app');
    const link = screen.getByRole('link', { name: 'Post on X' });
    const url = new URL(link.getAttribute('href') as string);
    expect(url.origin + url.pathname).toBe('https://x.com/intent/post');
    expect(url.searchParams.get('url')).toBe(INDEX.reportUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('sends the edited text and can reset it', async () => {
    const user = userEvent.setup();
    render(<ShareOnX requestId="r1" index={INDEX} />);
    const box = screen.getByRole('textbox', { name: 'Post' });
    await user.clear(box);
    await user.type(box, 'My own words');
    expect(new URL(screen.getByRole('link', { name: 'Post on X' }).getAttribute('href') as string).searchParams.get('text')).toBe('My own words');
    await user.click(screen.getByRole('button', { name: 'Reset text' }));
    expect((box as HTMLTextAreaElement).value).toContain('octo/app');
  });

  it('stops the link when the post is too long for X', async () => {
    const user = userEvent.setup();
    render(<ShareOnX requestId="r1" index={INDEX} />);
    await user.clear(screen.getByRole('textbox', { name: 'Post' }));
    await user.type(screen.getByRole('textbox', { name: 'Post' }), 'x'.repeat(270));
    expect(screen.queryByRole('link', { name: 'Post on X' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post on X' })).toBeDisabled();
    expect(screen.getByText(/too long for X/)).toBeInTheDocument();
  });

  it('does not put a finding title or file into the post', () => {
    render(<ShareOnX requestId="r1" index={INDEX} incomplete />);
    const value = (screen.getByRole('textbox', { name: 'Post' }) as HTMLTextAreaElement).value;
    expect(value).toContain('not a clean audit');
    expect(value).not.toMatch(/\.rs|\.ts|src\//);
  });
});
