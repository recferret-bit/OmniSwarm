import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import type { PipelineSummary, RequestStatusResponse } from '@/lib/api/schema.gen';
import { useRequestStatus } from '@/stores/request-status';
import { Dashboard } from '../dashboard/Dashboard';
import { PipelinePanel } from './PipelinePanel';
import { RequestStatusView } from './RequestStatusView';

const stepByStepSummary: PipelineSummary = {
  pipelineMode: 'step-by-step',
  currentStage: 'stage-2-advice',
  noDebates: true,
  roundsCompleted: 0,
  canRunMoreRounds: true,
  advice: {
    qualityRating: 'adequate',
    debateNeeded: true,
    recommendedDepth: 'standard',
    recommendedRounds: 2,
    summary: '2 high-severity claims lack cross-vendor agreement; run 2 debate rounds.',
  },
  incompletionNotes: [
    {
      category: 'timeout',
      code: 'worker_timeout',
      source: 'grok-s4',
      reason: 'Reviewer grok-s4 timed out after 900s on S4.',
      impact: 'External calls surface S4 lacks grok coverage.',
      nextStep: 'Resume failed sessions or inspect S4 manually.',
    },
  ],
  nextRoundRequestIds: ['3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10'],
};

describe('<PipelinePanel>', () => {
  it('renders STAGE 1 — NO DEBATES badge, frontier advice, incompletion impact notes, and triggers iterative debate rounds', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn(async () => undefined);
    render(<PipelinePanel pipeline={stepByStepSummary} incomplete canContinue onContinue={onContinue} />);

    expect(screen.getByText('STAGE 1 — NO DEBATES')).toBeInTheDocument();
    expect(screen.getByText('Quality: adequate')).toBeInTheDocument();
    expect(screen.getByText('Debate recommended: standard (2 rounds)')).toBeInTheDocument();
    expect(screen.getByText(/2 high-severity claims lack cross-vendor agreement/)).toBeInTheDocument();
    expect(screen.getByText(/Reviewer grok-s4 timed out after 900s on S4/)).toBeInTheDocument();
    expect(screen.getByText(/Impact: External calls surface S4 lacks grok coverage/)).toBeInTheDocument();
    expect(screen.getByText(/Follow-up pipeline steps:/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Step #1' })).toHaveAttribute('href', '/r/3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10');

    // Default selected rounds matches recommendedRounds (2); switch to 3 rounds and submit
    expect(screen.getByLabelText('2 rounds')).toBeChecked();
    await user.click(screen.getByLabelText('3 rounds'));
    const btn = screen.getByRole('button', { name: 'Run next debate round' });
    await user.click(btn);
    expect(onContinue).toHaveBeenCalledWith(3);
    // Busy state must reset after successful completion so further clicks are enabled
    expect(btn).not.toBeDisabled();
  });

  it('syncs selected rounds when pipeline.advice.recommendedRounds updates and resets busy on advise', async () => {
    const user = userEvent.setup();
    const onAdvise = vi.fn(async () => undefined);
    const onContinue = vi.fn(async () => undefined);
    const stage1Only: PipelineSummary = {
      pipelineMode: 'stage-1',
      currentStage: 'stage-1',
      noDebates: true,
      roundsCompleted: 0,
      canRunMoreRounds: true,
    };
    const { rerender } = render(
      <PipelinePanel pipeline={stage1Only} canContinue onAdvise={onAdvise} onContinue={onContinue} />,
    );
    expect(screen.getByLabelText('1 round')).toBeChecked();

    const adviseBtn = screen.getByRole('button', { name: 'Run Step 2 orchestrator advice' });
    await user.click(adviseBtn);
    expect(onAdvise).toHaveBeenCalledTimes(1);
    expect(adviseBtn).not.toBeDisabled();

    rerender(
      <PipelinePanel
        pipeline={{
          ...stepByStepSummary,
          advice: { ...stepByStepSummary.advice!, recommendedRounds: 3 },
        }}
        canContinue
        onAdvise={onAdvise}
        onContinue={onContinue}
      />,
    );
    expect(screen.getByLabelText('3 rounds')).toBeChecked();
  });

  it('surfaces error message if continuing debate fails or if Step 2 advice fails even when onContinue is provided and canRunMoreRounds is false', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn(async () => {
      throw new Error('Request is still running');
    });
    const { unmount } = render(<PipelinePanel pipeline={stepByStepSummary} canContinue onContinue={onContinue} />);
    await user.click(screen.getByRole('button', { name: 'Run next debate round' }));
    expect(await screen.findByText('Request is still running')).toBeInTheDocument();
    unmount();

    const onAdviseFail = vi.fn(async () => {
      throw new Error('Step 2 advice rejected: parent busy');
    });
    const stage1NoMoreRounds: PipelineSummary = {
      pipelineMode: 'stage-1',
      currentStage: 'stage-1',
      noDebates: true,
      roundsCompleted: 0,
      canRunMoreRounds: false,
    };
    render(
      <PipelinePanel
        pipeline={stage1NoMoreRounds}
        canContinue
        onAdvise={onAdviseFail}
        onContinue={vi.fn(async () => undefined)}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Run Step 2 orchestrator advice' }));
    expect(await screen.findByText('Step 2 advice rejected: parent busy')).toBeInTheDocument();
  });

  it('renders Step 2 orchestrator advice action when Stage 1 completed without advice', async () => {
    const user = userEvent.setup();
    const onAdvise = vi.fn(async () => undefined);
    const stage1Only: PipelineSummary = {
      pipelineMode: 'stage-1',
      currentStage: 'stage-1',
      noDebates: true,
      roundsCompleted: 0,
      canRunMoreRounds: true,
    };
    render(<PipelinePanel pipeline={stage1Only} canContinue onAdvise={onAdvise} />);
    await user.click(screen.getByRole('button', { name: 'Run Step 2 orchestrator advice' }));
    expect(onAdvise).toHaveBeenCalledTimes(1);
  });
});

describe('<Dashboard> pipelineMode selector', () => {
  it('sends pipelineMode when step-by-step or stage-1 is chosen', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'session').mockResolvedValue({ account: 'operator' });
    vi.spyOn(api, 'listMine').mockResolvedValue({ requests: [] });
    vi.spyOn(api, 'listAccountKeys').mockResolvedValue({ providers: [{
      provider: 'nearai', label: 'NEAR AI Cloud', set: true, fingerprint: 'ab12cd34', models: ['deepseek-ai/DeepSeek-V4'],
      dataPolicy: 'Reviewed source is sent to NEAR AI Cloud.', signedRequests: false,
    }] });
    const create = vi.spyOn(api, 'createDashboardJob').mockResolvedValue({
      requestId: '1', repo: 'near/near-sdk-rs', commitSha: 'a'.repeat(40), status: 'queued',
    });

    render(<Dashboard />);
    await screen.findByText(/key with 1 model/);
    await user.type(await screen.findByLabelText('GitHub repository'), 'near/near-sdk-rs');
    await user.click(screen.getByLabelText(/Step-by-step/));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(create).toHaveBeenCalledWith({
      repo: 'near/near-sdk-rs',
      scopes: ['full'],
      source: 'nearai',
      pipelineMode: 'step-by-step',
    });
  });
});

describe('<RequestStatusView> follow-up alert wording', () => {
  it('distinguishes Step 2 advice follow-up from Step 3 debate round follow-up', async () => {
    const user = userEvent.setup();
    const reqId = '11111111-2222-4333-8444-555555555555';
    const statusDoc: RequestStatusResponse = {
      status: 'done',
      incomplete: false,
      pipelineMode: 'stage-1',
      pipeline: {
        pipelineMode: 'stage-1',
        currentStage: 'stage-1',
        noDebates: true,
        roundsCompleted: 0,
        canRunMoreRounds: true,
      },
      createdAt: '2026-11-09T00:00:00.000Z',
    };
    useRequestStatus.setState({ byId: {} });
    vi.spyOn(api, 'getRequest').mockResolvedValue(statusDoc);
    vi.spyOn(api, 'getReport').mockRejectedValue(new Error('no receipt needed in unit test'));
    vi.spyOn(api, 'adviseRequest').mockResolvedValue({
      requestId: '22222222-2222-4333-8444-555555555555',
      repo: 'near/example',
      commitSha: 'a'.repeat(40),
      status: 'queued',
    });
    vi.spyOn(api, 'continueDebate').mockResolvedValue({
      requestId: '33333333-2222-4333-8444-555555555555',
      repo: 'near/example',
      commitSha: 'a'.repeat(40),
      status: 'queued',
    });

    render(<RequestStatusView id={reqId} />);
    const adviseBtn = await screen.findByRole('button', { name: 'Run Step 2 orchestrator advice' });
    await user.click(adviseBtn);
    expect(await screen.findByText('Follow-up Step 2 advice queued.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open advice run' })).toHaveAttribute('href', '/r/22222222-2222-4333-8444-555555555555');

    const debateBtn = screen.getByRole('button', { name: 'Run next debate round' });
    await user.click(debateBtn);
    expect(await screen.findByText('Follow-up debate round queued.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open debate round' })).toHaveAttribute('href', '/r/33333333-2222-4333-8444-555555555555');
  });
});
