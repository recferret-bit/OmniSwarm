// The API's only touch point with @omniswarm/guard (track S reworks that package). Everything else in
// the API talks to this port, so swapping the implementation is a one-file change.
import { verdictFor } from '@omniswarm/guard';

export interface GuardVerdict { verdict: 'allow' | 'warn' | 'block'; reasons: string[]; signals: Record<string, unknown> }

export interface GuardPort {
  verdict(account: string, network: string): Promise<GuardVerdict>;
}

export const packageGuard: GuardPort = {
  async verdict(account) {
    const result = verdictFor(account);
    return { verdict: result.verdict, reasons: result.reasons, signals: {} };
  },
};
