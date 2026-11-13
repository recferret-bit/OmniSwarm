import type { Status } from '@/lib/api/schema.gen';

const HAPPY: Status[] = ['queued', 'running', 'publishing', 'done'];
const LABEL: Record<Status, string> = {
  queued: 'Queued', running: 'Running', publishing: 'Publishing', done: 'Done', failed: 'Failed',
};

export function statusLabel(status: Status): string {
  return LABEL[status];
}

function steps(current: Status): Status[] {
  return current === 'failed' ? ['queued', 'running', 'failed'] : HAPPY;
}

export function Timeline({ status, phases }: { status: Status; phases: string[] }) {
  const list = steps(status);
  const at = list.indexOf(status);
  return (
    <div className="timeline">
      <ol className="timeline__steps" aria-label="Request status">
        {list.map((step, index) => (
          <li key={step} className={index < at ? 'is-done' : index === at ? 'is-current' : 'is-todo'} aria-current={index === at ? 'step' : undefined}>
            {LABEL[step]}
          </li>
        ))}
      </ol>
      {phases.length ? (
        <ol className="timeline__phases" aria-label="Review phases">
          {phases.map((phase) => <li key={phase}>{phase}</li>)}
        </ol>
      ) : null}
    </div>
  );
}
