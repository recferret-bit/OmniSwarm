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

declare module '@omniswarm/schemas/providers' {
  export interface Provider {
    id: string; label: string; transport: 'cli' | 'openai-chat'; family: string; specPrefix: string;
    baseUrl?: string; baseUrlEnv?: string | null; keyEnv: string | null; envAllowlist: readonly string[];
    extraBody?: Record<string, unknown>; headers?: Record<string, string>; modelsPath: string | null;
    keySources: readonly ('operator-env' | 'admin-page' | 'account')[]; dataPolicy: string;
  }
  export const MODEL_ID_PATTERN: string;
  export const PROVIDERS: readonly Provider[];
  export const ACCOUNT_PRESET_PREFIX: string;
  export function providerById(id: string): Provider | null;
  export function apiProviders(): Provider[];
  export function accountProviders(): Provider[];
  export function adminProviders(): Provider[];
  export function providerEnvNames(): string[];
  export function isModelId(model: unknown): boolean;
  export function specFor(providerId: string, model: string): string;
  export function providerOfSpec(spec: string): string | null;
  export function envForSpec(spec: string): string[];
  export function accountPresetName(providerId: string): string;
  export function accountPresetProvider(preset: string): string | null;
}

declare module '@omniswarm/schemas/nep413' {
  export const NEP413_TAG: number;
  export function nep413Payload(message: string, nonce: Uint8Array, recipient: string): Uint8Array;
  export function b58encode(bytes: Uint8Array): string;
  export function b58decode(text: string): Uint8Array;
}
