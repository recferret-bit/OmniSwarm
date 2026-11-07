'use client';

import { useMemo, useState } from 'react';
import { DesignNav } from '@/design/DesignNav';
import { STORIES } from '@/design/storybook/catalog';
import { StoryPanel } from '@/design/storybook/Panels';

export function Storybook() {
  const first = STORIES[0];
  const [id, setId] = useState(first?.id ?? 'button');
  const [tab, setTab] = useState<'canvas' | 'docs'>('canvas');
  const [paper, setPaper] = useState(false);
  const [query, setQuery] = useState('');
  const story = STORIES.find((item) => item.id === id) ?? first;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STORIES.filter((item) => !q || `${item.group} ${item.title}`.toLowerCase().includes(q));
  }, [query]);
  if (!story) return null;
  const groups = [...new Set(visible.map((item) => item.group))];

  return (
    <div className="sb">
      <aside className="sb-side">
        <a className="sb-brand" href="/design">
          <span><b>OMNI<em>SWARM</em></b><span className="label">Storybook · v1</span></span>
        </a>
        <DesignNav current="/design/storybook" />
        <div className="sb-search">
          <label htmlFor="sb-search" className="sr-only">Find a component</label>
          <input id="sb-search" className="input" placeholder="Find components" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <nav className="sb-tree" aria-label="Stories">
          {groups.map((group) => (
            <div key={group}>
              <div className="sb-group">{group}</div>
              {visible.filter((item) => item.group === group).map((item) => (
                <button key={item.id} type="button" className="sb-item" aria-current={item.id === story.id ? 'page' : undefined} onClick={() => setId(item.id)}>
                  {item.title}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="sb-main">
        <div className="sb-toolbar" role="toolbar" aria-label="Storybook view">
          <div role="tablist" aria-label="View">
            <button type="button" className="sb-tab" role="tab" aria-selected={tab === 'canvas'} onClick={() => setTab('canvas')}>Canvas</button>
            <button type="button" className="sb-tab" role="tab" aria-selected={tab === 'docs'} onClick={() => setTab('docs')}>Docs</button>
          </div>
          <span className="sb-sep" />
          <span className="dim">Background</span>
          <button type="button" className="sb-chip" aria-pressed={!paper} onClick={() => setPaper(false)}>Field</button>
          <button type="button" className="sb-chip" aria-pressed={paper} onClick={() => setPaper(true)}>Paper</button>
          <span className="sb-path">components / {story.id}</span>
        </div>
        <div className="sb-body">
          <div className="sb-head"><h1 className="h2">{story.title}</h1><p className="label">{story.group}</p></div>
          <div className="sb-docs plate" hidden={tab !== 'docs'}>
            <p className="label">Usage</p><p>{story.usage}</p>
            <p className="label">Do</p><p>{story.do}</p>
            <p className="label">Don&apos;t</p><p>{story.dont}</p>
            <p className="label">Import</p><p className="mono">{story.code}</p>
          </div>
          <div className={paper ? 'sb-canvas os-on-paper' : 'sb-canvas'} hidden={tab !== 'canvas'}>
            <StoryPanel id={story.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
