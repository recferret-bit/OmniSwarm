// The same MSW handlers the dev server uses, mounted in Node for store and
// component tests. jsdom has a location but Node's fetch cannot resolve
// relative URLs, so `/api/...` is resolved against it outside the interceptor.
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { handlers } from '@/mocks/handlers';

export function useMockApi() {
  const server = setupServer(...handlers);
  let original: typeof fetch;
  beforeAll(() => {
    server.listen({ onUnhandledFrame: 'error' });
    const intercepted = globalThis.fetch;
    original = intercepted;
    globalThis.fetch = (input, init) =>
      intercepted(typeof input === 'string' && input.startsWith('/') ? new URL(input, location.href) : input, init);
  });
  afterEach(() => server.resetHandlers());
  afterAll(() => {
    globalThis.fetch = original;
    server.close();
  });
  return server;
}
