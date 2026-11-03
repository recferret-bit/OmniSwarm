import { chainHandlers } from './chain';
import { intakeHandlers } from './intake';
import { statusHandlers } from './status';

export const handlers = [...intakeHandlers, ...statusHandlers, ...chainHandlers];
