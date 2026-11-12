'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

// WAI-ARIA tabs: arrow keys move between tabs, only the active tab is tabbable.
// Pass `selected` to control which tab is open. Omit it and the first tab starts open.
export function ReportTabs({ tabs, label, selected, onSelect }: { tabs: Tab[]; label: string; selected?: string; onSelect?: (id: string) => void }) {
  const [local, setLocal] = useState(tabs[0]?.id ?? '');
  const activeId = selected ?? local;
  const active = Math.max(0, tabs.findIndex((tab) => tab.id === activeId));
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const choose = (index: number) => {
    const id = tabs[index]?.id;
    if (!id) return;
    if (selected === undefined) setLocal(id);
    onSelect?.(id);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (active + delta + tabs.length) % tabs.length;
    choose(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tabs__list" onKeyDown={onKey}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => { refs.current[index] = node; }}
            role="tab"
            type="button"
            id={`${base}-${tab.id}-tab`}
            aria-controls={`${base}-${tab.id}-panel`}
            aria-selected={index === active}
            tabIndex={index === active ? 0 : -1}
            className="tabs__tab"
            onClick={() => choose(index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div key={tab.id} role="tabpanel" id={`${base}-${tab.id}-panel`} aria-labelledby={`${base}-${tab.id}-tab`} hidden={index !== active} className="tabs__panel" tabIndex={0}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
