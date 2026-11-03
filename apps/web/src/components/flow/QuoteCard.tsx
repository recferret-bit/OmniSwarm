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
    </div>
  );
}
