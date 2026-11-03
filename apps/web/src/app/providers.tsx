'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, type ReactNode } from 'react';
import { useRequestFlow } from '@/stores/request-flow';
import { useWallet } from '@/stores/wallet';

// Both comparisons are literals the bundler folds: with mocks off, the MSW
// worker, the handlers and the mock panel are never emitted.
const startMocks = process.env.NEXT_PUBLIC_API_MOCK === '1'
  ? () => import('../mocks/browser').then((mod) => mod.startMocks())
  : null;
const MockPanel = process.env.NEXT_PUBLIC_API_MOCK === '1' ? dynamic(() => import('../mocks/MockPanel'), { ssr: false }) : null;

let booting: Promise<void> | null = null;

// Once per page load, even when StrictMode mounts the provider twice.
function bootstrap(): Promise<void> {
  booting ??= boot();
  return booting;
}

async function boot() {
  if (startMocks) await startMocks();
  await useRequestFlow.persist.rehydrate();
  const flow = useRequestFlow.getState();
  // A reload during "Confirming" resumes confirming the same transaction.
  if (flow.step === 'confirming' && flow.txHash) void flow.confirm();
  void useWallet.getState().restore();
}

export function Providers({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(startMocks === null);

  useEffect(() => {
    let live = true;
    bootstrap().finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);

  return (
    <>
      {ready ? children : <p role="status" className="boot">Starting…</p>}
      {MockPanel ? <MockPanel /> : null}
    </>
  );
}
