import type { ChainReader, RecordedChain } from './types.js';

export function createRecordedReader(records: RecordedChain, options?: { fail?: ReadonlySet<keyof ChainReader> }): ChainReader;
