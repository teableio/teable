import { get, template } from 'lodash';
import { useCallback, useContext } from 'react';
import { AppContext } from '../AppContext';
import type { ILocaleFunction, TValue } from './types';

export const useTranslation = () => {
  const { locale, lang } = useContext(AppContext);
  const t = useCallback<ILocaleFunction>(
    (key, options) => {
      const translation = get(locale, key) as unknown as TValue;
      if (!translation) {
        console.warn(`Translation for '${key}' not found.`);
      }
      if (options) {
        const compiled = template(translation, { interpolate: /\{\{([\s\S]+?)\}\}/g });
        return compiled(options);
      }
      return translation;
    },
    [locale]
  );
  return {
    t,
    lang,
  };
};
