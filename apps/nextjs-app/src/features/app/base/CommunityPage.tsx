import { useTheme } from '@teable/next-themes';
import { BillingProductLevel } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/base';
import Image from 'next/image';
import { Trans, useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { useBaseUsageWithLoading } from '../hooks/useBaseUsage';

export const CommunityPage = ({
  buildBaseWelcomeVisible = true,
}: {
  buildBaseWelcomeVisible?: boolean;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { loading, isFetched, baseUsage } = useBaseUsageWithLoading();

  const { level } = baseUsage || {};

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // free user or community user
  const isCommunityOrFreeUser = level === BillingProductLevel.Free || level === undefined;

  // community user, loading alway be true
  if (loading && isFetched) {
    return null;
  }

  return !buildBaseWelcomeVisible || isCommunityOrFreeUser ? (
    <div className="h-full flex-col md:flex">
      <div className="flex h-full flex-1 flex-col gap-2 lg:gap-4">
        <div className="items-center justify-between space-y-2 px-8 pb-2 pt-6 lg:flex">
          <h2 className="text-3xl font-bold tracking-tight">{t('table:welcome.title')}</h2>
        </div>
        <div className="flex h-full flex-col items-center justify-center p-4 ">
          <Image
            src={isDark ? '/images/layout/welcome-dark.png' : '/images/layout/welcome-light.png'}
            alt="No roles available"
            width={240}
            height={240}
          />
          <ul className="my-4 flex flex-col justify-center items-center space-y-2 max-w-[720px] text-center">
            <li className="text-lg font-semibold">{t('table:welcome.emptyTitle')}</li>
            <li>{t('table:welcome.description')}</li>
            <li>
              <Trans
                ns="table"
                i18nKey="welcome.help"
                components={{
                  HelpCenter: (
                    <a
                      href={t('help.mainLink')}
                      className="text-blue-500 hover:text-blue-700"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('table:welcome.helpCenter')}
                    </a>
                  ),
                }}
              ></Trans>
            </li>
          </ul>
        </div>
      </div>
    </div>
  ) : (
    // for ai feature user to loading
    <div className="flex h-full min-w-0 items-center justify-center overflow-hidden transition-all md:flex">
      <Spin className="min-w-0" />
    </div>
  );
};
