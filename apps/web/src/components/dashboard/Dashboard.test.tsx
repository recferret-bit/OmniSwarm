import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type AccountKeyView } from '@/lib/api/client';
import { AppError } from '@/lib/api/errors';
import { Dashboard } from './Dashboard';

function near(extra: Partial<AccountKeyView> = {}): AccountKeyView {
  return { provider: 'nearai', label: 'NEAR AI Cloud', set: false, fingerprint: null, models: [], dataPolicy: 'Reviewed source is sent to NEAR AI Cloud.', signedRequests: false, ...extra };
}

describe('<Dashboard>', () => {
  beforeEach(() => {
    vi.spyOn(api, 'session').mockRejectedValue(new AppError('UNAUTHORIZED', undefined, { status: 401 }));
    vi.spyOn(api, 'listMine').mockResolvedValue({ requests: [] });
    vi.spyOn(api, 'login').mockResolvedValue({ account: 'operator' });
    vi.spyOn(api, 'listAccountKeys').mockResolvedValue({ providers: [near()] });
  });

  it('signs in through the client and shows the repository field', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await user.type(await screen.findByLabelText('Login'), 'operator');
    await user.type(screen.getByLabelText('Password'), 'operator');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(api.login).toHaveBeenCalledWith({ login: 'operator', password: 'operator' });
    expect(await screen.findByLabelText('GitHub repository')).toBeInTheDocument();
    expect(api.listMine).toHaveBeenCalled();
  });

  it('saves a NEAR AI key and never echoes it back', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'session').mockResolvedValue({ account: 'operator' });
    const save = vi.spyOn(api, 'saveAccountKey').mockResolvedValue(near({ set: true, fingerprint: 'ab12cd34' }));
    render(<Dashboard />);
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
    expect(await screen.findByLabelText(/NEAR AI Cloud \(your key\) · 1 model/)).toBeChecked();
    expect(screen.getByLabelText('deepseek-ai/DeepSeek-V4 (orchestrator)')).toBeChecked();
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
    await user.click(await screen.findByLabelText(/NEAR AI Cloud \(your key\) · save a key/));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Load models from NEAR AI Cloud' }));
    await user.click(await screen.findByLabelText('b/two'));
    expect(save).toHaveBeenCalledWith('nearai', { models: ['b/two'] });
  });
});
