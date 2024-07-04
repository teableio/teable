import { useTranslation } from 'next-i18next';
import { useEffect } from 'react';
import { z } from 'zod';
import { makeZodI18nMap } from 'zod-i18n-map';

export const useInitializationZodI18n = () => {
  const { t } = useTranslation();

  useEffect(() => {
    z.setErrorMap(makeZodI18nMap({ t }));
  }, [t]);
};
