'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { messageFor } from '@/lib/api/errors';
import { useMyRequests, type MyRequest } from '@/stores/my-requests';
import { selectAccountId, selectWalletStatus, useWallet } from '@/stores/wallet';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { statusLabel } from './Timeline';

function Row({ row }: { row: MyRequest }) {
  const tone = row.status === 'done' ? 'good' : row.status === 'failed' || row.status === 'refunded' ? 'bad' : 'info';
  return (
    <li className="request-row">
      <Link href={`/r/${row.requestId}`} className="request-row__repo">{row.repo}</Link>
      <Pill tone={tone}>{statusLabel(row.status)}</Pill>
      <time className="muted" dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
    </li>
  );
}

export function MyRequests() {
  const accountId = useWallet(selectAccountId);
  const walletStatus = useWallet(selectWalletStatus);
  const connect = useWallet((state) => state.connect);
  const { status, requests, error, load, clear } = useMyRequests(useShallow(({ status, requests, error, load, clear }) => ({ status, requests, error, load, clear })));

  useEffect(() => {
    if (accountId) void load();
    else clear();
  }, [accountId, load, clear]);

  if (!accountId) {
    return (
      <div>
        <p>Connect your wallet to see your requests</p>
        <Button onClick={() => void connect()} busy={walletStatus === 'connecting' || walletStatus === 'restoring'}>Connect NEAR wallet</Button>
      </div>
    );
  }
  if (status === 'error' && error) return <Alert>{error === 'UNAUTHORIZED' ? 'Sign a request from this browser to see your requests.' : messageFor(error)}</Alert>;
  if (status !== 'ready') return <p role="status">Loading your requests…</p>;
  if (!requests.length) return <p>No requests yet. <Link href="/dashboard">Review a repository</Link>.</p>;
  return <ul className="request-list" aria-label="Your requests">{requests.map((row) => <Row key={row.requestId} row={row} />)}</ul>;
}
