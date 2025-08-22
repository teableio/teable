import { BillingProductLevel } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/base';
import { Trans, useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { useChatPanelStore } from '../components/sidebar/useChatPanelStore';
import { useBaseUsageWithLoading } from '../hooks/useBaseUsage';

export const CommunityPage = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { baseUsage, loading, isFetched } = useBaseUsageWithLoading();
  const { level } = baseUsage || {};
  const { isExpanded } = useChatPanelStore();
  // free user or community user
  const displayDefaultBaseWelcome = level === BillingProductLevel.Free || level === undefined;

  // community user, loading alway be true
  if (loading && isFetched) {
    return null;
  }

  // billing user never see the welcome page
  return displayDefaultBaseWelcome ? (
    <div className="h-full flex-col md:flex">
      <div className="flex h-full flex-1 flex-col gap-2 lg:gap-4">
        <div className="items-center justify-between space-y-2 px-8 pb-2 pt-6 lg:flex">
          <h2 className="text-3xl font-bold tracking-tight">{t('table:welcome.title')}</h2>
        </div>
        <div className="flex h-full flex-col items-center justify-center p-4">
          <ul className="mb-4 space-y-2 text-left">
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
    <div className="flex h-full min-w-0 items-center justify-center overflow-hidden transition-all md:flex">
      {!isExpanded && <Spin className="min-w-0" />}
    </div>
  );
};
