'use client';

// Dev/e2e only. Loaded with next/dynamic({ssr:false}) so msw/browser is never
// bundled for the server; starts the worker once, then shows the mock panel.
import { useEffect, useState } from 'react';
import { startMocks } from './browser';
import MockPanel from './MockPanel';

let starting: Promise<void> | null = null;

export default function MockBoot({ onReady }: { onReady: () => void }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    let live = true;
    starting ??= startMocks();
    void starting.then(() => {
      if (!live) return;
      setStarted(true);
      onReady();
    });
    return () => { live = false; };
  }, [onReady]);
  return started ? <MockPanel /> : null;
}
