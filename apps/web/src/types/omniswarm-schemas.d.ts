// Types for the isomorphic helpers in packages/schemas (plain .mjs, no .d.ts yet).
// The signatures mirror canonical-message.mjs, canonical-json.mjs and nep413.mjs.

declare module '@omniswarm/schemas/canonical-message' {
  export interface CanonicalRequestFields {
    account: string;
    commit: string;
    deployed?: string | null;
    network: string;
    nonce: string;
    preset: string;
    repo: string;
  }
  export function canonicalRequestMessage(input: CanonicalRequestFields): string;
  export function requestHash(message: string): Promise<string>;
}

declare module '@omniswarm/schemas/canonical-json' {
  export function canonicalJson(value: unknown): string;
  export function reportDocument(findings: unknown, general: unknown): string;
  export function digestReport(findings: unknown, general: unknown): Promise<string>;
}

declare module '@omniswarm/schemas/nep413' {
  export const NEP413_TAG: number;
  export function nep413Payload(message: string, nonce: Uint8Array, recipient: string): Uint8Array<ArrayBuffer>;
  export function b58encode(bytes: Uint8Array): string;
  export function b58decode(text: string): Uint8Array;
}
