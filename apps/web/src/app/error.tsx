'use client';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <h1>Something went wrong</h1>
      <Alert action={<Button variant="secondary" onClick={reset}>Try again</Button>}>This page failed to load. Nothing was changed.</Alert>
    </>
  );
}
