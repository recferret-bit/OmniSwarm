import Link from 'next/link';
import { SignInButton } from '@/components/auth/SignIn';
import { env } from '@/lib/env';

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
          <Link href="/dashboard">Dashboard</Link>
          {/* The anchor exists only when a donation account is configured (components/support/Donate.tsx). */}
          {env.donationAccount ? <Link href="/#support">Support</Link> : null}
          <Link href="/design">Design</Link>
        </nav>
        <SignInButton />
      </div>
    </header>
  );
}
