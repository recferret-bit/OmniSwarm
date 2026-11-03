import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setMockError, setWalletReject } from '@/mocks/controls';
import { useRequestFlow } from '@/stores/request-flow';
import { useWallet } from '@/stores/wallet';
import { useMockApi } from '@/test/msw';
import { RequestFlow } from './RequestFlow';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

useMockApi();

beforeEach(() => {
  push.mockReset();
  useRequestFlow.getState().reset();
  useWallet.setState({ status: 'idle', accountId: null, error: null });
});

async function quote(repo: string) {
  const user = userEvent.setup();
  render(<RequestFlow />);
  await user.type(screen.getByLabelText('GitHub repository'), repo);
  await user.click(screen.getByRole('button', { name: 'Get quote' }));
  return user;
}

describe('<RequestFlow>', () => {
  it('shows an inline error for input that is not a repository', async () => {
    await quote('foo bar');
    expect(await screen.findByText(/Not a GitHub repository/)).toBeInTheDocument();
    expect(screen.getByLabelText('GitHub repository')).toHaveAttribute('aria-invalid', 'true');
  });

  it('QUEUE_FULL never offers Sign or Pay', async () => {
    setMockError('QUEUE_FULL');
    await quote('near/near-sdk-rs');
    expect(await screen.findByRole('alert')).toHaveTextContent('Queue is full, try later');
    expect(screen.queryByRole('button', { name: /Sign request|Pay/ })).not.toBeInTheDocument();
  });

  it('a private repo explains why it cannot be reviewed', async () => {
    setMockError('REPO_PRIVATE');
    await quote('near/near-sdk-rs');
    expect(await screen.findByRole('alert')).toHaveTextContent('This repository is private. Only public repositories can be reviewed.');
    expect(screen.queryByRole('button', { name: 'Sign request' })).not.toBeInTheDocument();
  });

  it('connect, sign, a wallet rejection with Retry, then pay routes to the status page', async () => {
    const user = await quote('https://github.com/near-examples/guest-book-examples');
    expect(await screen.findByText('1 NEAR')).toBeInTheDocument();
    expect(screen.getByText('#0 in queue')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect NEAR wallet' }));
    await user.click(await screen.findByRole('button', { name: 'Sign request' }));
    expect(await screen.findByTestId('request-hash')).toHaveTextContent(/^[0-9a-f]{64}$/);
    setWalletReject(true);
    await user.click(screen.getByRole('button', { name: 'Pay 1 NEAR' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Payment cancelled in wallet.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/r/${useRequestFlow.getState().request!.requestId}`));
    expect(screen.getByText(/Payment confirmed — queued #1/)).toBeInTheDocument();
  });
});
