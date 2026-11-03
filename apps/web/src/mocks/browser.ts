// Dev/e2e only. Starts the MSW service worker (public/mockServiceWorker.js is
// copied there by scripts/msw-worker.mjs only when NEXT_PUBLIC_API_MOCK=1).
// Requests that leave the page origin without a handler fail loudly, so a mock
// run never reaches a real RPC, GitHub or reports host.
import { setupWorker } from 'msw/browser';
import { applySearchParams } from './controls';
import { handlers } from './handlers';

export async function startMocks(): Promise<void> {
  applySearchParams(window.location.search);
  const worker = setupWorker(...handlers);
  await worker.start({
    quiet: true,
    serviceWorker: { url: '/mockServiceWorker.js' },
    onUnhandledFrame({ frame, defaults }) {
      const request = (frame.data as { request?: Request } | null)?.request;
      if (request && new URL(request.url).origin !== window.location.origin) defaults.error();
    },
  });
}
