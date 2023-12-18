import { get } from 'lodash';
import { useCallback, useContext } from 'react';
import { AppContext } from '../AppContext';
import type { TKey, TValue } from './types';

export const useTranslation = () => {
  const { locale } = useContext(AppContext);
  const t = useCallback(
    (key: TKey): TValue => {
      const translation = get(locale, key) as unknown as TValue;
      if (!translation) {
        console.warn(`Translation for '${key}' not found.`);
      }
      return translation;
    },
    [locale]
  );
  return {
    t,
  };
};
