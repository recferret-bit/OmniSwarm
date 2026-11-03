// Types for the dependency-free .mjs workspace packages the API imports by name.

declare module '@omniswarm/schemas' {
  export function validate(name: string, value: unknown): { ok: boolean; errors: string[] };
  export function loadSchema(name: string): Record<string, unknown>;
  export function listSchemas(): string[];
  export const SCHEMA_DIR: string;
}

declare module '@omniswarm/schemas/canonical-message' {
  export interface RequestMessageFields {
    account: string; commit: string; deployed: string | null; network: string; nonce: string; preset: string; repo: string;
  }
  export function canonicalRequestMessage(input: RequestMessageFields): string;
  export function requestHash(message: string): Promise<string>;
}

declare module '@omniswarm/schemas/canonical-json' {
  export function canonicalJson(value: unknown): string;
  export function reportDocument(findings: unknown, general: unknown): string;
  export function digestReport(findings: unknown, general: unknown): Promise<string>;
}

declare module '@omniswarm/schemas/nep413' {
  export const NEP413_TAG: number;
  export function nep413Payload(message: string, nonce: Uint8Array, recipient: string): Uint8Array;
  export function b58encode(bytes: Uint8Array): string;
  export function b58decode(text: string): Uint8Array;
}

declare module '@omniswarm/guard' {
  export function verdictFor(account: string): { verdict: 'allow' | 'warn' | 'block'; reasons: string[]; account: string };
}
