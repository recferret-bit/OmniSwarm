import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPage from './page';

const activity = {
  freeChecks: true,
  jobs: [
    {
      id: '11111111-1111-1111-1111-111111111111', account: 'operator', repo: 'acme/app', status: 'failed',
      scope: 'web3', theme: null, parentId: null, failureCause: 'no directory matched the selected scope', createdAt: '2026-11-07T12:00:00.000Z',
    },
    {
      id: '22222222-2222-2222-2222-222222222222', account: 'guest', repo: 'acme/web', status: 'queued',
      scope: 'full', theme: 'apps', parentId: '11111111-1111-1111-1111-111111111111', failureCause: null, createdAt: '2026-11-07T12:05:00.000Z',
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('<AdminPage>', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/activity')) return json(activity);
      if (url.endsWith('/settings') && init?.method === 'PUT') return json({ freeChecks: false });
      return json({}, 404);
    }));
  });

  it('shows operators, jobs and settings on separate tabs', async () => {
    const user = userEvent.setup();
    render(<AdminPage />);

    expect(await screen.findByRole('tab', { name: 'Operators' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Jobs' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /operator/ })).toBeInTheDocument();
    const activityStats = screen.getByLabelText('Activity');
    expect(within(activityStats).getByText('Operators').nextElementSibling).toHaveTextContent('2');
    expect(within(activityStats).getByText('Jobs').nextElementSibling).toHaveTextContent('2');
    expect(within(activityStats).getByText('Failed').nextElementSibling).toHaveTextContent('1');

    await user.click(screen.getByRole('tab', { name: 'Jobs' }));
    expect(screen.getByRole('tab', { name: 'Jobs' })).toHaveAttribute('aria-selected', 'true');
    const table = screen.getByRole('table', { name: 'Jobs' });
    expect(within(table).getByRole('link', { name: 'acme/app' })).toHaveAttribute('href', '/r/11111111-1111-1111-1111-111111111111');
    expect(within(table).getByRole('link', { name: 'acme/web · apps' })).toHaveAttribute('href', '/r/22222222-2222-2222-2222-222222222222');
    expect(within(table).getByText('no directory matched the selected scope')).toBeInTheDocument();
    expect(within(table).getByText('Failed')).toBeInTheDocument();
    expect(within(table).getByText('Queued')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.queryByRole('heading', { name: /Provider keys/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Allow free checks/ })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: /Require payment/ }));
    expect(fetch).toHaveBeenCalledWith('/api/operator/settings', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ freeChecks: false }),
    }));
    expect(await screen.findByText('Payment is required before a review is queued.')).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/operator/providers'))).toBe(false);
  });
});
