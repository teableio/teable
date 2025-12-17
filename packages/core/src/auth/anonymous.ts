export const ANONYMOUS_USER_ID = 'anonymous';

export const isAnonymous = (userId: string) => userId === ANONYMOUS_USER_ID;

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ANONYMOUS_USER = {
  id: ANONYMOUS_USER_ID,
  name: 'Anonymous',
  email: 'anonymous@system.teable.ai',
};
