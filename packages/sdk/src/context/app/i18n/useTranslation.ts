import { get, template } from 'lodash';
import { useCallback, useContext } from 'react';
import { AppContext } from '../AppContext';
import type { ILocaleFunction, ILocalePluralFunction, TValue } from './types';

const selectPluralForm = (lang: string | undefined, count: number) => {
  try {
    return new Intl.PluralRules(lang || 'en').select(count);
  } catch {
    return 'other';
  }
};

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
  // Locale files only carry the CLDR plural forms valid for their language
  // (e.g. zh/ja have no `_one`), so the form must be picked per language here.
  const tPlural = useCallback<ILocalePluralFunction>(
    (key, count, options) => {
      const pluralForm = selectPluralForm(lang, count);
      const translation = (get(locale, `${key}_${pluralForm}`) ??
        get(locale, `${key}_other`)) as unknown as TValue;
      if (!translation) {
        console.warn(`Translation for '${key}_${pluralForm}' not found.`);
      }
      const compiled = template(translation, { interpolate: /\{\{([\s\S]+?)\}\}/g });
      return compiled({ count, ...options });
    },
    [locale, lang]
  );
  return {
    t,
    tPlural,
    lang,
  };
};
