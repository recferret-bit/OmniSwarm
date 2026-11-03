import { accountUrl } from '@/lib/near/explorer';
import { Button } from '../ui/Button';

export function AccountChip({ accountId, onSignOut }: { accountId: string; onSignOut: () => void }) {
  return (
    <div className="account-chip" data-testid="account">
      <a className="account-chip__id" href={accountUrl(accountId)} target="_blank" rel="noreferrer">{accountId}</a>
      <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
    </div>
  );
}
