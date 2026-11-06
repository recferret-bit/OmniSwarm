import Link from 'next/link';
import { WalletSlot } from '../wallet/WalletSlot';

export function SiteHeader() {
  return (
    <header className="site-header">
      <nav className="site-header__nav" aria-label="Main">
        <Link className="site-header__brand" href="/">OmniSwarm</Link>
        <Link href="/sample">Sample report</Link>
        <Link href="/me">My requests</Link>
        <Link href="/local">Local</Link>
        <Link href="/dashboard">Dashboard</Link>
      </nav>
      <WalletSlot />
    </header>
  );
}
