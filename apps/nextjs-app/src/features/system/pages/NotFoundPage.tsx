import { Button } from '@teable/ui-lib/shadcn';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';

import { systemConfig } from '@/features/i18n/system.config';

type Props = {
  title?: string;
  children?: never;
};

export const NotFoundPage: FC<Props> = (props) => {
  const { t } = useTranslation(systemConfig.i18nNamespaces);
  const title = props.title ?? t('system:notFound.title');

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="flex h-screen flex-col items-center justify-center gap-y-6 bg-white text-center">
        <h1 data-testid="not-found-title" className="text-5xl text-black md:text-4xl lg:text-5xl">
          {title}
        </h1>
        <Button className="text-center text-xl no-underline hover:underline">
          <a href={'/'}>{t('system:links.backToHome')}</a>
        </Button>
      </div>
    </>
  );
};
