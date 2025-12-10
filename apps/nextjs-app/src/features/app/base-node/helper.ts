import type { SSRResult } from './types';

export const redirect = (destination: string): SSRResult => ({
  redirect: { destination, permanent: false },
});
