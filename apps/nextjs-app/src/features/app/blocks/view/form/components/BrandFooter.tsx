/* eslint-disable @next/next/no-html-link-for-pages */
import { TeableNew } from '@teable/icons';
import { Trans, useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

export const BrandFooter = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return (
    <div className="flex w-full items-center justify-center">
      <span className="h-px w-16 bg-slate-200 dark:bg-slate-600" />
      <div className="mx-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Trans
          ns="common"
          i18nKey="poweredBy"
          components={[
            <a
              key={'brandFooter'}
              href="/"
              className="flex items-center text-sm text-black dark:text-white"
            >
              <TeableNew className="text-xl text-black" />
              <span className="ml-1 font-semibold">{t('brand')}</span>
            </a>,
          ]}
        />
      </div>
      <span className="h-px w-16 bg-slate-200 dark:bg-slate-600" />
    </div>
  );
};
