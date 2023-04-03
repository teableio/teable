import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import type { FC } from 'react';
import { appConfig } from '../app.config';

export const AppPage: FC = () => {
  const { t } = useTranslation(appConfig.i18nNamespaces);
  return (
    <>
      <NextSeo
        title={t('app:page.title')}
        description="Teable: the database for everyone https://github.com/teable-group/teable"
      />
    </>
  );
};
