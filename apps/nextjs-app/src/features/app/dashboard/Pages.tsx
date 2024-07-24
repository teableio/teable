import { StandaloneViewProvider } from '@teable/sdk/context';
import { Button, Tabs } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useLocalStorage } from 'react-use';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { Pickers } from './components/Pickers';
import { GridContent } from './GridContent';

export function DashboardPage() {
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  const [anchor, setAnchor] = useState<{ tableId?: string; viewId?: string }>({});
  const { query } = useRouter();
  const { viewId, tableId } = anchor;
  const [showDashboard, setShowDashboard] = useLocalStorage('showDashboard', false);
  return (
    <StandaloneViewProvider viewId={viewId} tableId={tableId} baseId={query.baseId as string}>
      <div className="h-full flex-col md:flex">
        <div className="flex h-full flex-1 flex-col gap-2 lg:gap-4">
          <div className="items-center justify-between space-y-2 px-8 pb-2 pt-6 lg:flex">
            <h2 className="text-3xl font-bold tracking-tight">{t('common:noun.dashboard')}</h2>
          </div>
          {!showDashboard ? (
            <div className="flex h-full flex-col items-center justify-center p-4">
              <ul className="mb-4 space-y-2 text-left">
                <li>Click the + sign on the left sidebar to create a table.</li>
                <li>
                  Visit the{' '}
                  <a
                    href={t('help.mainLink')}
                    className="text-blue-500 hover:text-blue-700"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Help Center
                  </a>{' '}
                  for assistance.
                </li>
                <li>
                  Dashboard is under development,
                  <Button
                    className="text-md"
                    variant="link"
                    size="xs"
                    onClick={() => setShowDashboard(true)}
                  >
                    click to view demo
                  </Button>
                </li>
              </ul>
            </div>
          ) : (
            <Tabs defaultValue="overview" className="overflow-y-auto">
              <div className="p-8">
                <Pickers setAnchor={setAnchor} />
              </div>
              <GridContent />
            </Tabs>
          )}
        </div>
      </div>
    </StandaloneViewProvider>
  );
}
