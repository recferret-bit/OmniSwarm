import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/api/errors';
import type { WalletConnector } from '@/lib/near/connector';
import { buildDonationTx, DONATION_DEPOSIT, DONATION_GAS, formatUsdc, toUsdcUnits } from '@/lib/near/donation';
import { useWallet } from '@/stores/wallet';
import { Donate, NATIVE_ONLY } from './Donate';

const USDC = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';

function fakeWallet(send: WalletConnector['signAndSendTransaction']): () => Promise<WalletConnector> {
  const wallet: WalletConnector = {
    restore: async () => 'alice.testnet',
    connect: async () => 'alice.testnet',
    signOut: async () => undefined,
    signMessage: async () => { throw new Error('not used'); },
    signAndSendTransaction: send,
    onSignOut: () => () => undefined,
  };
  return async () => wallet;
}

describe('donation amounts', () => {
  it.each([
    ['5', '5000000'],
    ['0.5', '500000'],
    ['25', '25000000'],
    ['12.34', '12340000'],
    ['0.01', '10000'],
    [' 100 ', '100000000'],
  ])('%s USDC is %s base units', (amount, units) => {
    expect(toUsdcUnits(amount)).toBe(units);
  });

  it.each(['0', '0.00', '-1', '1.234', '', 'abc', '1e3', '01', '.5', '5.', '1,5', 'Infinity'])('rejects %j', (amount) => {
    expect(toUsdcUnits(amount)).toBeNull();
  });

  it('formats base units back without floats', () => {
    expect(formatUsdc('5000000')).toBe('5');
    expect(formatUsdc('500000')).toBe('0.5');
    expect(formatUsdc('12340000')).toBe('12.34');
    expect(formatUsdc('10000')).toBe('0.01');
  });

  it('builds a NEP-141 ft_transfer with exactly 1 yoctoNEAR attached', () => {
    expect(buildDonationTx({ usdcContract: USDC, recipient: 'omniswarm.testnet', units: '5000000' })).toEqual({
      receiverId: USDC,
      actions: [{
        type: 'FunctionCall',
        params: {
          methodName: 'ft_transfer',
          args: { receiver_id: 'omniswarm.testnet', amount: '5000000', memo: 'OmniSwarm donation' },
          gas: '30000000000000',
          deposit: '1',
        },
      }],
    });
    expect(DONATION_DEPOSIT).toBe('1');
    expect(DONATION_GAS).toBe('30000000000000');
    expect(() => buildDonationTx({ usdcContract: USDC, recipient: 'omniswarm.testnet', units: '0' })).toThrow();
  });
});

describe('<Donate>', () => {
  beforeEach(() => useWallet.setState({ status: 'idle', accountId: null, error: null }));

  it('renders nothing without a donation account', () => {
    const { container } = render(<Donate account={null} usdcContract={USDC} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden by default when NEXT_PUBLIC_DONATION_ACCOUNT is unset', () => {
    const { container } = render(<Donate />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains what donations pay for and always shows the manual address with the native USDC warning', () => {
    render(<Donate account="omniswarm.testnet" usdcContract={USDC} />);
    expect(screen.getByRole('heading', { name: 'Keep OmniSwarm free' })).toBeInTheDocument();
    expect(screen.getByText(/Servers, sandbox runners, storage, the domain and coffee for the maintainers/)).toBeInTheDocument();
    expect(screen.getByText(/never unlocks anything, in USDC on NEAR/)).toBeInTheDocument();
    expect(screen.queryByText(/OmniSwarm charges nothing/)).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /5 USDC · Buy us a coffee/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /25 USDC · A day of infrastructure/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /100 USDC · A month of a sandbox runner/ })).toBeInTheDocument();
    expect(screen.getByTestId('donation-account')).toHaveTextContent('omniswarm.testnet');
    expect(screen.getByRole('button', { name: 'Copy omniswarm.testnet' })).toBeInTheDocument();
    expect(screen.getByText(NATIVE_ONLY)).toBeInTheDocument();
    expect(screen.getByText(USDC)).toBeInTheDocument();
    // Not connected: connect is offered and the donate button waits for it.
    expect(screen.getByRole('button', { name: 'Connect NEAR wallet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Donate 5 USDC' })).toBeDisabled();
  });

  it('keeps only the manual address when the network has no USDC contract', () => {
    render(<Donate account="omniswarm.test.near" usdcContract={null} variant="footer" />);
    expect(screen.getByRole('heading', { name: 'Support OmniSwarm' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect NEAR wallet' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Donate/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('donation-account')).toHaveTextContent('omniswarm.test.near');
    expect(screen.getByText(NATIVE_ONLY)).toBeInTheDocument();
  });

  it('copies the recipient account', async () => {
    const user = userEvent.setup();
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    render(<Donate account="omniswarm.testnet" usdcContract={USDC} />);
    await user.click(screen.getByRole('button', { name: 'Copy omniswarm.testnet' }));
    expect(write).toHaveBeenCalledWith('omniswarm.testnet');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('sends a custom amount as ft_transfer and links the transaction', async () => {
    const user = userEvent.setup();
    useWallet.setState({ status: 'connected', accountId: 'alice.testnet', error: null });
    const send = vi.fn<WalletConnector['signAndSendTransaction']>(async () => ({ txHash: 'TxHash111' }));
    render(<Donate account="omniswarm.testnet" usdcContract={USDC} connector={fakeWallet(send)} />);

    await user.click(screen.getByRole('radio', { name: /Custom amount/ }));
    const field = screen.getByLabelText('Amount in USDC');
    await user.type(field, '1.234');
    expect(screen.getByText(/at most 2 decimals/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Donate' })).toBeDisabled();
    await user.clear(field);
    await user.type(field, '0');
    expect(screen.getByRole('button', { name: 'Donate' })).toBeDisabled();
    await user.clear(field);
    await user.type(field, '-1');
    expect(screen.getByRole('button', { name: 'Donate' })).toBeDisabled();
    await user.clear(field);
    await user.type(field, '0.5');

    await user.click(screen.getByRole('button', { name: 'Donate 0.5 USDC' }));
    expect(send).toHaveBeenCalledWith(buildDonationTx({ usdcContract: USDC, recipient: 'omniswarm.testnet', units: '500000' }));
    expect(await screen.findByText(/0.5 USDC transfer sent/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View the transaction' })).toHaveAttribute('href', 'https://explorer.mock.invalid/txns/TxHash111');
  });

  it('shows the wallet error and sends nothing more', async () => {
    const user = userEvent.setup();
    useWallet.setState({ status: 'connected', accountId: 'alice.testnet', error: null });
    const send = vi.fn<WalletConnector['signAndSendTransaction']>(async () => { throw new AppError('WALLET_REJECTED'); });
    render(<Donate account="omniswarm.testnet" usdcContract={USDC} connector={fakeWallet(send)} />);
    await user.click(screen.getByRole('radio', { name: /25 USDC/ }));
    await user.click(screen.getByRole('button', { name: 'Donate 25 USDC' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].actions[0].params.args).toEqual({ receiver_id: 'omniswarm.testnet', amount: '25000000', memo: 'OmniSwarm donation' });
    expect(await screen.findByText('Donation cancelled in wallet. Nothing was sent.')).toBeInTheDocument();
  });
});

describe('donation QR code', () => {
  it('shows one QR code of the recipient on the landing band and on the dashboard footer', () => {
    const { unmount } = render(<Donate account="omniswarm.testnet" usdcContract={USDC} />);
    expect(screen.getByRole('img', { name: /QR code of the donation account omniswarm\.testnet/ })).toBeInTheDocument();
    unmount();
    render(<Donate account="omniswarm.testnet" usdcContract={null} variant="footer" />);
    expect(screen.getByRole('img', { name: /QR code of the donation account omniswarm\.testnet/ })).toBeInTheDocument();
  });
});
