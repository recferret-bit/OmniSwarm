import { fileHandlers } from './files';
import { intakeHandlers } from './intake';
import { localHandlers } from './local';
import { sessionHandlers } from './session';
import { statusHandlers } from './status';

export const handlers = [...intakeHandlers, ...statusHandlers, ...fileHandlers, ...sessionHandlers, ...localHandlers];
