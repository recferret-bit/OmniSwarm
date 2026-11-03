'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRequestFlow } from '@/stores/request-flow';
import { useWallet } from '@/stores/wallet';

// A literal the bundler folds: with mocks off, the MSW worker, the handlers and
// the mock panel are never emitted (npm run guard checks the build output).
const MockBoot = process.env.NEXT_PUBLIC_API_MOCK === '1'
  ? dynamic(() => import('../mocks/MockBoot'), { ssr: false })
  : null;

let booting: Promise<void> | null = null;

// Once per page load, even when StrictMode mounts the provider twice.
function bootstrap(): Promise<void> {
  booting ??= (async () => {
    await useRequestFlow.persist.rehydrate();
    const flow = useRequestFlow.getState();
    // A reload during "Confirming" resumes confirming the same transaction.
    if (flow.step === 'confirming' && flow.txHash) void flow.confirm();
    void useWallet.getState().restore();
  })();
  return booting;
}

export function Providers({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState(MockBoot === null);
  const [ready, setReady] = useState(false);
  const onMocksReady = useCallback(() => setNetwork(true), []);

  useEffect(() => {
    if (!network) return undefined;
    let live = true;
    void bootstrap().finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [network]);

  return (
    <>
      {MockBoot === null || ready ? children : <p role="status" className="boot">Starting…</p>}
      {MockBoot ? <MockBoot onReady={onMocksReady} /> : null}
    </>
  );
}
