import type { SignedRequest } from '@/stores/request-flow';

export function SignedSummary({ signed }: { signed: SignedRequest }) {
  return (
    <details className="signed-summary" data-testid="signed-request">
      <summary>Request hash <code data-testid="request-hash">{signed.requestHash}</code></summary>
      <dl>
        <dt>Public key</dt><dd><code data-testid="public-key">{signed.publicKey}</code></dd>
        <dt>Signature (base64)</dt><dd><code data-testid="signature">{signed.signature}</code></dd>
        <dt>Nonce (from /api/challenge)</dt><dd><code data-testid="nonce">{signed.nonce}</code></dd>
        <dt>Signed message</dt><dd><pre data-testid="signed-message">{signed.message}</pre></dd>
      </dl>
    </details>
  );
}
