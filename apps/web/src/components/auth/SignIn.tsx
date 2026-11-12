'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { api, type SessionAccount } from '@/lib/api/client';
import { toAppError } from '@/lib/api/errors';
import { buildFastAuthLoginUrl, readOauthMessage } from '@/lib/auth/fastauth';
import { signInWithNear } from '@/lib/auth/near-login';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';

const POPUP_FEATURES = 'popup,width=500,height=680';
const POPUP_BLOCKED = 'The sign-in popup was blocked. Allow popups and try again.';

type ProviderId = 'google' | 'x' | 'near';
type Phase = 'popup' | 'api' | null;

function ProviderSignIn({ onSignedIn, trigger }: { onSignedIn: (session: SessionAccount) => void; trigger: boolean }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const popupRef = useRef<Window | null>(null);
  const phaseRef = useRef<Phase>(null);
  const timerRef = useRef<number | null>(null);
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  const [pending, setPending] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (session: SessionAccount) => {
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    onSignedInRef.current(session);
  };

  const fail = (caught: unknown) => {
    phaseRef.current = null;
    popupRef.current = null;
    setPending(null);
    setError(toAppError(caught).message);
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const hit = readOauthMessage(event, popupRef.current, window.location.origin);
      if (!hit || phaseRef.current === 'api') return;
      phaseRef.current = 'api';
      setPending(hit.provider);
      setError(null);
      void api.loginSocial({ provider: hit.provider, token: hit.token })
        .then((session) => {
          phaseRef.current = null;
          popupRef.current = null;
          setPending(null);
          finish(session);
        })
        .catch(fail);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  function watchPopup(popup: Window) {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      if (!popup.closed) return;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
      if (phaseRef.current === 'popup' && popupRef.current === popup) {
        phaseRef.current = null;
        popupRef.current = null;
        setPending(null);
      }
    }, 400);
  }

  function startOAuth(provider: 'google' | 'x') {
    if (phaseRef.current) return;
    setError(null);
    const popup = window.open(buildFastAuthLoginUrl(window.location.origin, provider), 'omni-fastauth-oauth', POPUP_FEATURES);
    if (!popup) {
      setError(POPUP_BLOCKED);
      return;
    }
    phaseRef.current = 'popup';
    popupRef.current = popup;
    setPending(provider);
    watchPopup(popup);
  }

  function startNear() {
    if (phaseRef.current) return;
    phaseRef.current = 'api';
    setPending('near');
    setError(null);
    void signInWithNear()
      .then((session) => {
        phaseRef.current = null;
        setPending(null);
        finish(session);
      })
      .catch(fail);
  }

  const busy = pending !== null;
  const buttons = (
    <div className="quote-form">
      <Button style={{ width: '100%' }} disabled={busy} busy={pending === 'google'} onClick={() => startOAuth('google')}>Google</Button>
      <Button style={{ width: '100%' }} disabled={busy} busy={pending === 'x'} onClick={() => startOAuth('x')}>X</Button>
      <Button style={{ width: '100%' }} disabled={busy} busy={pending === 'near'} onClick={() => startNear()}>NEAR</Button>
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );

  if (!trigger) return buttons;

  function openDialog() {
    const dialog = dialogRef.current;
    if (!dialog) return;
    setError(null);
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  return (
    <>
      <Button variant="ghost" onClick={openDialog}>Sign in</Button>
      <dialog
        ref={dialogRef}
        className="panel"
        aria-labelledby={titleId}
        style={{ margin: 'auto', maxWidth: '24rem', width: 'calc(100% - 32px)' }}
        onClick={(event) => {
          if (event.target === dialogRef.current && dialogRef.current.open) dialogRef.current.close();
        }}
      >
        <h2 id={titleId} className="panel__title">Sign in</h2>
        {buttons}
        <Button variant="ghost" onClick={() => { if (dialogRef.current?.open) dialogRef.current.close(); }}>Close</Button>
      </dialog>
    </>
  );
}

/** Header control. A signed-in session links to the dashboard; otherwise a dialog. */
export function SignInButton() {
  const router = useRouter();
  const [session, setSession] = useState<SessionAccount | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void api.session()
      .then((value) => { if (live) setSession(value); })
      .catch(() => { if (live) setSession(null); });
    return () => { live = false; };
  }, []);

  if (session === undefined) return null;
  if (session) {
    const name = session.label || session.account;
    return <Link className="button button--ghost" href="/dashboard">{name}</Link>;
  }
  return <ProviderSignIn trigger onSignedIn={() => router.push('/dashboard')} />;
}

/** Logged-out dashboard. Calls `onSignedIn` instead of navigating. */
export function SignInPanel({ onSignedIn }: { onSignedIn: (session: SessionAccount) => void }) {
  return (
    <Panel title="Sign in">
      <ProviderSignIn trigger={false} onSignedIn={onSignedIn} />
    </Panel>
  );
}
