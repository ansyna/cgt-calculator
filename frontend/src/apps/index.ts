import type { AppDefinition } from '../platform/apps';
import { cgt } from './cgt';

/** The apps, in the switcher's order; a session starts in the first. */
export const APPS: AppDefinition[] = [cgt];
