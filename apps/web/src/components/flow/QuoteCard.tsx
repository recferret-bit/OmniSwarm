import type { QuoteResponse } from '@/lib/api/schema.gen';
import { formatNear } from '@/lib/near/payment';
import { repoUrl } from '@/lib/repo';
import { Stat, StatGrid } from '../ui/Stat';

export function QuoteCard({ quote }: { quote: QuoteResponse }) {
  return (
    <div className="quote-card" data-testid="quote">
      <StatGrid label="Quote">
        <Stat label="Repository" value={quote.normalizedRepo} />
        <Stat label="Commit" value={<a href={`${repoUrl(quote.normalizedRepo)}/commit/${quote.commitSha}`}><code>{quote.commitSha.slice(0, 7)}</code></a>} />
        <Stat label="Price" value={formatNear(quote.priceYocto)} />
        <Stat label="Queue" value={`#${quote.queueDepth} in queue`} />
        <Stat label="ETA" value={`about ${quote.etaMinutes} min`} />
      </StatGrid>
      {quote.large ? <p>This repository is large. A full, web2 or web3 check is split into theme jobs (web3, apps, infra, scripts) and those jobs run in parallel. Queue it from the dashboard; the scope you ticked is kept for that form.</p> : null}
    </div>
  );
}
