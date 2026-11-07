import type { components } from '../generated/api';

/**
 * The API's data, as described in api/openapi.json. src/generated/api.ts is generated from that file
 * (npm run api:types) whenever the backend changes, so these types can't drift from what the API returns.
 */
export type Schemas = components['schemas'];

export type CurrentUser = Schemas['CurrentUser'];
export type AuthResponse = Schemas['AuthResponse'];
export type ErrorBody = Schemas['ErrorBody'];

/** A page of a list (users, roles, activity). */
export type Page<T> = Omit<Schemas['PageDtoUserDto'], 'content'> & { content: T[] };
