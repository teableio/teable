import { z } from '@teable/openapi';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { makeZodI18nMap } from 'zod-i18n-map';

export const useInitializationZodI18n = () => {
  const { t } = useTranslation();

  useEffect(() => {
    z.setErrorMap(makeZodI18nMap({ t }));
  }, [t]);
};
