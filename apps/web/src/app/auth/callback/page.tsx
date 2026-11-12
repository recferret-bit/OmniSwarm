'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { toAppError } from '@/lib/api/errors';
import { fastAuthRetryUrl, readFastAuthCallback } from '@/lib/auth/fastauth';

export default function AuthCallbackPage() {
  const [status, setStatus] = useState('Completing sign-in…');

  useEffect(() => {
    const origin = window.location.origin;
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state') ?? '';
    if (!state.startsWith('omni-fastauth:')) {
      setStatus('This sign-in link is not valid.');
      return;
    }
    const retry = fastAuthRetryUrl(origin, params);
    if (retry) {
      window.location.replace(retry);
      return;
    }
    const hit = readFastAuthCallback(origin, params);
    if (!hit) {
      setStatus('Sign-in did not complete.');
      if (window.opener) window.close();
      return;
    }
    if (window.opener) {
      try {
        window.opener.postMessage({ type: 'omni:oauth', provider: hit.provider, token: hit.token }, origin);
        window.close();
        setStatus('Signed in. You can close this window.');
        return;
      } catch {
        // The opener is gone. Sign in this window instead.
      }
    }
    void api.loginSocial({ provider: hit.provider, token: hit.token })
      .then(() => { window.location.assign('/dashboard'); })
      .catch((error) => setStatus(toAppError(error).message));
  }, []);

  return (
    <main id="main" className="main">
      <h1>Sign in</h1>
      <p role="status">{status}</p>
    </main>
  );
}
