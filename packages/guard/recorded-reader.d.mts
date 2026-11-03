import type { AccountAgeSource, ChainReader, RecordedChain } from './types.js';

export function createRecordedReader(records: RecordedChain, options?: { fail?: ReadonlySet<keyof ChainReader> }): Required<ChainReader>;
export function createRecordedAgeSource(createdAtMs: Record<string, number>, options?: { fail?: boolean }): AccountAgeSource;
