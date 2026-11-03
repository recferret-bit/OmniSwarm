'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Verification } from '@/lib/report/verify';

export type VerificationState =
  | { phase: 'checking' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; result: Verification };

// Runs a verification on mount and on `recheck()`; ignores stale results.
export function useVerification(run: (() => Promise<Verification>) | null) {
  const [state, setState] = useState<VerificationState>({ phase: 'checking' });
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!run) return undefined;
    let live = true;
    setState({ phase: 'checking' });
    run().then(
      (result) => { if (live) setState({ phase: 'done', result }); },
      (error: unknown) => { if (live) setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { live = false; };
  }, [run, round]);

  const recheck = useCallback(() => setRound((value) => value + 1), []);
  return { state, recheck };
}
