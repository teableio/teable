'use client';

import type { i18n, Resource } from 'i18next';
import { createInstance } from 'i18next';
import { useEffect, useMemo, useRef } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import type { PageType } from './types';

const globalI18nMap: Partial<Record<PageType, i18n | null>> = {};

export const isServer = typeof window === 'undefined';

const i18nConfigDefault = {
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
};

const initTranslation = (
  pageType: PageType,
  options: {
    lang: string;
    resources: Resource;
    defaultNS?: string;
  }
) => {
  const globalI18n = globalI18nMap[pageType];
  const { lang, resources, defaultNS } = options;
  const i18nOptions = {
    ...i18nConfigDefault,
    lng: lang,
    defaultNS,
    resources: JSON.parse(JSON.stringify(resources)),
    initImmediate: false,
  };
  if (globalI18n) {
    return globalI18n.cloneInstance(i18nOptions);
  }
  const i18nInstance = createInstance();
  i18nInstance.use(initReactI18next).init(i18nOptions);

  globalI18nMap[pageType] = i18nInstance;
  return i18nInstance;
};

export const I18nProvider = (props: {
  children: React.ReactNode;
  lang?: string;
  resources: Resource;
  pageType: PageType;
  defaultNS?: string;
}) => {
  const { children, lang = 'en', pageType, ...rest } = props;
  const instanceRef = useRef<i18n>();

  const i18n = useMemo(() => {
    let instance = instanceRef.current;
    if (instance) {
      return instance;
    } else {
      instance = initTranslation(pageType, {
        lang,
        ...rest,
      });
    }
    instanceRef.current = instance;
    return instance;
  }, [lang, pageType, rest]);

  useEffect(() => {
    if (!i18n || !lang) return;
    i18n.changeLanguage(lang);
  }, [i18n, lang]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
};
