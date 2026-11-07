import Link from 'next/link';
import { DesignNav } from '@/design/DesignNav';

const PAGES = [
  { href: '/', k: '01 · Page', title: 'Landing', body: 'The public page: a live canvas, a cited example, what ships today, and what does not.' },
  { href: '/design/foundations', k: '02 · Guide', title: 'Foundations', body: 'Color, contrast, type, voice, plates, spacing and the rules that keep the system strict.' },
  { href: '/design/storybook', k: '03 · Components', title: 'Storybook', body: 'Every view control in the app, with canvas and docs, on field and on paper.' },
  { href: '/design/motion', k: '04 · Motion', title: 'Motion', body: 'Latch, sweep and step. Twelve specimens. Pause and reduced motion both hold still.' },
];

export function DesignIndex() {
  return (
    <div className="doc">
      <DesignNav current="/design" />
      <header className="doc-title">
        <div>
          <p className="eyebrow">OmniSwarm design system · v1</p>
          <h1 className="display">Source Mark</h1>
          <p className="lede">
            Field, paper, ember for action, cite blue for reference. One token file.
            Chamfered plates. The landing and the app both use it.
          </p>
        </div>
      </header>
      <section className="cols-2">
        {PAGES.map((page) => (
          <Link key={page.href} className="card plate card-hover" href={page.href}>
            <p className="label">{page.k}</p>
            <h2 className="h3">{page.title}</h2>
            <p className="muted">{page.body}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
