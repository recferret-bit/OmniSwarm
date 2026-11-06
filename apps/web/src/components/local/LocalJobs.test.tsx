import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { useMockApi } from '@/test/msw';
import { LocalJobs } from './LocalJobs';

useMockApi();

describe('<LocalJobs>', () => {
  it('does not submit when both fields are empty or both are filled', async () => {
    const create = vi.spyOn(api, 'createLocalJob');
    const user = userEvent.setup();
    render(<LocalJobs />);
    expect(await screen.findByText('No local jobs yet.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Local repository path')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('GitHub repository')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText('Enter a local path or a GitHub repository.')).toHaveLength(2);

    await user.type(screen.getByLabelText('Local repository path'), '/tmp/repo');
    await user.type(screen.getByLabelText('GitHub repository'), 'near/near-sdk-rs');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Local repository path')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('GitHub repository')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText('Enter either a local path or a GitHub repository, not both.')).toHaveLength(2);
  });
});
