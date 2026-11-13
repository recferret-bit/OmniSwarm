import Link from 'next/link';

export const REPO_URL = 'https://github.com/recferret-bit/OmniSwarm';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__bar">
        <Link className="site-footer__mark" href="/">OmniSwarm</Link>
        <nav className="site-footer__groups" aria-label="Footer">
          <div className="site-footer__group">
            <p className="site-footer__eyebrow" id="footer-product">PRODUCT</p>
            <ul className="site-footer__links" aria-labelledby="footer-product">
              <li><Link href="/sample">Sample report</Link></li>
              <li><Link href="/design">Design system</Link></li>
              <li><Link href="/design/storybook">Storybook</Link></li>
            </ul>
          </div>
          <div className="site-footer__group">
            <p className="site-footer__eyebrow" id="footer-source">SOURCE</p>
            <ul className="site-footer__links" aria-labelledby="footer-source">
              <li><a href={REPO_URL}>Source on GitHub</a></li>
              <li><a href={`${REPO_URL}/blob/main/docs/RULES.md`}>Review rules (RULES.md)</a></li>
              <li><a href={`${REPO_URL}/blob/main/README.md`}>README</a></li>
              <li><a href={`${REPO_URL}/blob/main/LICENSE`}>MIT licence</a></li>
            </ul>
          </div>
        </nav>
        <p className="site-footer__note">Model agreement does not certify security.</p>
      </div>
    </footer>
  );
}
