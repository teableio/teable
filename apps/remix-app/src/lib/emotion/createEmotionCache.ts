import createCache from '@emotion/cache';
import type { EmotionCache } from '@emotion/cache';

export const createEmotionCache = (): EmotionCache => {
  return createCache({ key: 'css' });
};
