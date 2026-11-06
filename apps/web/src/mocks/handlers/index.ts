import { chainHandlers } from './chain';
import { guardHandlers } from './guard';
import { intakeHandlers } from './intake';
import { ledgerHandlers } from './ledger';
import { localHandlers } from './local';
import { sessionHandlers } from './session';
import { statusHandlers } from './status';

export const handlers = [
  ...intakeHandlers, ...statusHandlers, ...ledgerHandlers, ...guardHandlers, ...chainHandlers, ...sessionHandlers, ...localHandlers,
];
