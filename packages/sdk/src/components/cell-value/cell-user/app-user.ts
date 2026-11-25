// People who signed in to a published App, not to Teable, carry `apu_` principal ids.
export const APP_USER_ID_PREFIX = 'apu_';

export const isAppUserId = (id: unknown): boolean =>
  typeof id === 'string' && id.startsWith(APP_USER_ID_PREFIX);
