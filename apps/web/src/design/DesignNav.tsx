import Link from 'next/link';

const LINKS = [
  ['/design', 'Index'],
  ['/', 'Landing'],
  ['/design/foundations', 'Foundations'],
  ['/design/storybook', 'Storybook'],
  ['/design/motion', 'Motion'],
] as const;

export function DesignNav({ current }: { current: string }) {
  return (
    <nav className="doc-nav" aria-label="Design system">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={current === href ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
