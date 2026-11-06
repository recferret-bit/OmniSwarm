import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { AppError } from '@/lib/api/errors';
import { Dashboard } from './Dashboard';

describe('<Dashboard>', () => {
  beforeEach(() => {
    vi.spyOn(api, 'session').mockRejectedValue(new AppError('UNAUTHORIZED', undefined, { status: 401 }));
    vi.spyOn(api, 'listMine').mockResolvedValue({ requests: [] });
    vi.spyOn(api, 'login').mockResolvedValue({ account: 'operator' });
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
});
