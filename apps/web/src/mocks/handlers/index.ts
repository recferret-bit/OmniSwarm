import { chainHandlers } from './chain';
import { guardHandlers } from './guard';
import { intakeHandlers } from './intake';
import { ledgerHandlers } from './ledger';
import { statusHandlers } from './status';

export const handlers = [...intakeHandlers, ...statusHandlers, ...ledgerHandlers, ...guardHandlers, ...chainHandlers];
