import { AnchorProvider } from '@teable-group/sdk/context';
import { Tabs } from '@teable-group/ui-lib/shadcn';
import { Alert, AlertTitle, AlertDescription } from '@teable-group/ui-lib/shadcn/ui/alert';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { Pickers } from './components/Pickers';
import { GridContent } from './GridContent';

export function DashboardPage() {
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  const [anchor, setAnchor] = useState<{ tableId?: string; viewId?: string }>({});
  const { viewId, tableId } = anchor;

  return (
    <AnchorProvider viewId={viewId} tableId={tableId}>
      <div className="h-full flex-col md:flex">
        <div className="flex h-full flex-1 flex-col gap-2 lg:gap-4">
          <div className="items-center justify-between space-y-2 px-8 pb-2 pt-6 lg:flex">
            <h2 className="text-3xl font-bold tracking-tight">{t('common:noun.dashboard')}</h2>
          </div>
          <Tabs defaultValue="overview" className="overflow-y-auto">
            <div className="flex justify-center p-4">
              <Alert className="w-[400px]">
                <AlertTitle>
                  <span className="text-lg">🏗️</span> Coming soon
                </AlertTitle>
                <AlertDescription>
                  The feature is under development, you can try the demo below
                </AlertDescription>
              </Alert>
            </div>
            <div className="p-8">
              <Pickers setAnchor={setAnchor} />
            </div>
            <GridContent />
          </Tabs>
        </div>
      </div>
    </AnchorProvider>
  );
}
