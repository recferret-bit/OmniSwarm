import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MyRequests } from '../request/MyRequests';
import { useWallet } from '@/stores/wallet';
import { WalletSlot } from './WalletSlot';

beforeEach(() => useWallet.setState({ status: 'idle', accountId: null, error: null }));

describe('<WalletSlot>', () => {
  it('connects to the account chip, survives a restore and signs out', async () => {
    const user = userEvent.setup();
    render(<><WalletSlot /><MyRequests /></>);
    expect(screen.getByText('Connect your wallet to see your requests')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Connect NEAR wallet' })[0]!);
    expect(await screen.findByTestId('account')).toHaveTextContent('alice.testnet');

    useWallet.setState({ status: 'idle', accountId: null });
    await useWallet.getState().restore();
    expect(await screen.findByTestId('account')).toHaveTextContent('alice.testnet');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.queryByTestId('account')).not.toBeInTheDocument();
    expect(screen.getByText('Connect your wallet to see your requests')).toBeInTheDocument();
  });
});
