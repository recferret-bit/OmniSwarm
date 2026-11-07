import Link from 'next/link';
import { ThemeSwitch } from './ThemeSwitch';
import { WalletSlot } from '../wallet/WalletSlot';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__bar">
        <nav className="site-header__nav" aria-label="Main">
          <Link className="site-header__brand" href="/">OmniSwarm</Link>
          <Link href="/#features">Features</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/#example">Example</Link>
          <Link href="/#now">Now</Link>
          <Link href="/#roadmap">Roadmap</Link>
          <Link href="/sample">Sample</Link>
          <Link href="/me">My requests</Link>
          <Link href="/local">Local</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/design">Design</Link>
        </nav>
        <ThemeSwitch />
        <WalletSlot />
      </div>
    </header>
  );
}
