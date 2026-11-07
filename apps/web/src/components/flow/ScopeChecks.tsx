'use client';

export const SCOPE_CHOICES = [
  ['full', 'Full check', 'Every theme. A large repo is split and reviewed in parallel.'],
  ['web3', 'Web3 check', 'Contracts, programs and chain clients only.'],
  ['web2', 'Web2 check', 'Apps, infra and scripts. Chain trees are left out.'],
] as const;

export function ScopeChecks({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const toggle = (id: string, on: boolean) => {
    if (id === 'full') onChange(on ? ['full'] : []);
    else {
      const withoutFull = selected.filter((item) => item !== 'full');
      onChange(on ? [...withoutFull, id] : withoutFull.filter((item) => item !== id));
    }
  };
  return (
    <fieldset className="quote-form">
      <legend>Scope</legend>
      <p className="muted">Choose this before the review is queued. A large repository is split into web3, apps, infra and scripts, one job each.</p>
      {SCOPE_CHOICES.map(([id, label, hint]) => (
        <label key={id}>
          <input type="checkbox" name="scope" value={id} checked={selected.includes(id)} onChange={(event) => toggle(id, event.target.checked)} />
          {' '}{label}
          <span className="muted"> — {hint}</span>
        </label>
      ))}
    </fieldset>
  );
}
