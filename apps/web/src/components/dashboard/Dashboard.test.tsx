import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type AccountKeyView } from '@/lib/api/client';
import { AppError } from '@/lib/api/errors';
import { env } from '@/lib/env';
import { Dashboard, OWN_KEY_PROMPT } from './Dashboard';

function near(extra: Partial<AccountKeyView> = {}): AccountKeyView {
  return { provider: 'nearai', label: 'NEAR AI Cloud', set: false, fingerprint: null, models: [], dataPolicy: 'Reviewed source is sent to NEAR AI Cloud.', signedRequests: false, ...extra };
}

describe('<Dashboard>', () => {
  beforeEach(() => {
    vi.spyOn(api, 'session').mockRejectedValue(new AppError('UNAUTHORIZED', undefined, { status: 401 }));
    vi.spyOn(api, 'listMine').mockResolvedValue({ requests: [] });
    vi.spyOn(api, 'listAccountKeys').mockResolvedValue({ providers: [near()] });
  });

  it('offers Google, X and NEAR when signed out and no password field', async () => {
    render(<Dashboard />);
    expect(await screen.findByRole('button', { name: 'Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'X' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'NEAR' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Login')).not.toBeInTheDocument();
  });

  it('links a review to the dashboard request page', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    vi.spyOn(api, 'session').mockResolvedValue({ account: 'operator' });
    vi.spyOn(api, 'listMine').mockResolvedValue({
      requests: [{ requestId, repo: 'near/near-sdk-rs', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    render(<Dashboard />);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Review history' }));
    expect(screen.getByRole('link', { name: 'near/near-sdk-rs' })).toHaveAttribute('href', `/dashboard/requests/${requestId}`);
  });

  it('saves a NEAR AI key and never echoes it back', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'session').mockResolvedValue({ account: 'operator' });
    const save = vi.spyOn(api, 'saveAccountKey').mockResolvedValue(near({ set: true, fingerprint: 'ab12cd34' }));
    render(<Dashboard />);
    await user.click(await screen.findByRole('tab', { name: 'Settings' }));
    const field = await screen.findByLabelText('NEAR AI Cloud API key');
    expect(field).toHaveAttribute('type', 'password');
    await user.type(field, 'near-test-key');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(save).toHaveBeenCalledWith('nearai', { key: 'near-test-key' });
    expect(await screen.findByText(/Key saved · ab12cd34/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('near-test-key')).toBeNull();
  });

  it('defaults to the account key with saved models and submits that provider as the source', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'session').mockResolvedValue({ account: 'operator' });
    vi.spyOn(api, 'listAccountKeys').mockResolvedValue({ providers: [near({ set: true, fingerprint: 'ab12cd34', models: ['deepseek-ai/DeepSeek-V4'] })] });
    const create = vi.spyOn(api, 'createDashboardJob').mockResolvedValue({ requestId: '1', repo: 'near/near-sdk-rs', commitSha: 'a'.repeat(40), status: 'queued' });
    render(<Dashboard />);
    expect((await screen.findAllByRole('tab')).map((item) => item.textContent)).toEqual(['New review', 'Review history', 'Settings']);
    expect(screen.getByRole('tab', { name: 'New review' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('review-source')).toHaveTextContent(/NEAR AI Cloud key with 1 model; deepseek-ai\/DeepSeek-V4 orchestrates/);
    expect(screen.queryByText(/Hosted panel/)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Opus|Sol|Argon|Grok/, hidden: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.getByLabelText('deepseek-ai/DeepSeek-V4 (orchestrator)')).toBeChecked();
    await user.click(screen.getByRole('tab', { name: 'New review' }));
    await user.type(screen.getByLabelText('GitHub repository'), 'near/near-sdk-rs');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(create).toHaveBeenCalledWith({ repo: 'near/near-sdk-rs', scopes: ['full'], source: 'nearai' });
  });

  it('blocks an own-key submit until a key and a model are saved, and loads the model list on request', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'session').mockResolvedValue({ account: 'operator' });
    vi.spyOn(api, 'listAccountKeys').mockResolvedValue({ providers: [near({ set: true, fingerprint: 'ab12cd34' })] });
    vi.spyOn(api, 'listProviderModels').mockResolvedValue({ source: 'live', models: ['a/one', 'b/two'] });
    const save = vi.spyOn(api, 'saveAccountKey').mockResolvedValue(near({ set: true, fingerprint: 'ab12cd34', models: ['b/two'] }));
    render(<Dashboard />);
    // No model yet: the key panel opens first and explains who pays.
    expect(await screen.findByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('tabpanel')).getByText(OWN_KEY_PROMPT)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Submit', hidden: true })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Load models from NEAR AI Cloud' }));
    await user.click(await screen.findByLabelText('b/two'));
    expect(save).toHaveBeenCalledWith('nearai', { models: ['b/two'] });
  });

  it('explains the own key when none is saved and never offers a hosted panel', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'session').mockResolvedValue({ account: 'operator' });
    const create = vi.spyOn(api, 'createDashboardJob');
    render(<Dashboard />);
    expect(await screen.findByLabelText('NEAR AI Cloud API key')).toBeVisible();
    expect(within(screen.getByRole('tabpanel')).getByText(OWN_KEY_PROMPT)).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'New review' }));
    expect(screen.getByTestId('review-source')).toHaveTextContent(OWN_KEY_PROMPT);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(screen.queryByText(/Z\.AI|OpenRouter|Hosted panel/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add your NEAR AI key' }));
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps submit disabled and says so when the key settings cannot load', async () => {
    vi.spyOn(api, 'session').mockResolvedValue({ account: 'operator' });
    vi.spyOn(api, 'listAccountKeys').mockRejectedValue(new AppError('INTERNAL'));
    render(<Dashboard />);
    expect(await screen.findByText(/key settings could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('shows the optional donation panel below the dashboard only when a donation account is set', async () => {
    vi.spyOn(api, 'session').mockResolvedValue({ account: 'operator' });
    const { unmount } = render(<Dashboard />);
    await screen.findByRole('tab', { name: 'New review' });
    expect(screen.queryByRole('heading', { name: 'Support OmniSwarm' })).not.toBeInTheDocument();
    unmount();

    const before = env.donationAccount;
    env.donationAccount = 'omniswarm.testnet';
    try {
      render(<Dashboard />);
      expect(await screen.findByRole('heading', { name: 'Support OmniSwarm' })).toBeInTheDocument();
      expect(screen.getByTestId('donation-account')).toHaveTextContent('omniswarm.testnet');
    } finally {
      env.donationAccount = before;
    }
  });
});
