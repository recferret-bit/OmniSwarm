// Types for the isomorphic helpers in packages/schemas (plain .mjs, no .d.ts yet).
// The signatures mirror canonical-message.mjs, canonical-json.mjs and nep413.mjs.

// Node-only validator (reads the schema files with fs); used by tests, never by the app.
declare module '@omniswarm/schemas' {
  export function validate(name: string, value: unknown): { ok: boolean; errors: string[] };
}

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

// Public half of the provider catalog only: the browser never imports key variable names or base URLs.
declare module '@omniswarm/schemas/providers-public' {
  export interface PublicProvider {
    id: string; label: string; transport: 'cli' | 'openai-chat'; family: string; specPrefix: string;
    modelsPath: string | null; keySources: readonly string[]; dataPolicy: string;
  }
  export const MODEL_ID_PATTERN: string;
  export const PUBLIC_PROVIDERS: readonly PublicProvider[];
  export const ACCOUNT_PRESET_PREFIX: string;
  export function isModelId(model: unknown): boolean;
  export function publicAccountProviders(): PublicProvider[];
  export function publicAdminProviders(): PublicProvider[];
  export function accountPresetName(providerId: string): string;
  export function accountPresetProvider(preset: string): string | null;
}

declare module '@omniswarm/schemas/nep413' {
  export const NEP413_TAG: number;
  export function nep413Payload(message: string, nonce: Uint8Array, recipient: string): Uint8Array<ArrayBuffer>;
  export function b58encode(bytes: Uint8Array): string;
  export function b58decode(text: string): Uint8Array;
}
