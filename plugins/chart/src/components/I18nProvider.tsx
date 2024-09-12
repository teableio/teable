'use client';

import enSDkJson from '@teable/common-i18n/src/locales/en/sdk.json';
import zhSDkJson from '@teable/common-i18n/src/locales/zh/sdk.json';
import type { i18n } from 'i18next';
import { createInstance } from 'i18next';
import { useEffect, useMemo, useRef } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import enCommonJson from '../locales/en.json';
import zhCommonJson from '../locales/zh.json';

let globalI18n: i18n | null = null;

export const isServer = typeof window === 'undefined';

const resources = {
  en: { sdk: enSDkJson, common: enCommonJson },
  zh: { sdk: zhSDkJson, common: zhCommonJson },
};

const i18nConfigDefault = {
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
};

const initTranslation = (lang: string) => {
  if (globalI18n) {
    return globalI18n!.cloneInstance({
      ...i18nConfigDefault,
      lng: lang,
      resources: JSON.parse(JSON.stringify(resources)),
      initImmediate: false,
    });
  }
  const i18nInstance = createInstance();
  i18nInstance.use(initReactI18next).init({
    ...i18nConfigDefault,
    lng: lang,
    resources: JSON.parse(JSON.stringify(resources)),
  });

  globalI18n = i18nInstance;
  return i18nInstance;
};

export const I18nProvider = (props: { children: React.ReactNode; lang?: string }) => {
  const { children, lang = 'en' } = props;
  const instanceRef = useRef<i18n>();

  const i18n = useMemo(() => {
    let instance = instanceRef.current;
    if (instance) {
      return instance;
    } else {
      instance = initTranslation(lang);
    }
    instanceRef.current = instance;
    return instance;
  }, [lang]);

  useEffect(() => {
    if (!i18n || !lang) return;
    i18n.changeLanguage(lang);
  }, [i18n, lang]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
};
