import { AnchorContext, TablePermissionProvider } from '@teable/sdk/context';
import { Button, Separator } from '@teable/ui-lib/shadcn';
import { ChevronLeft } from 'lucide-react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { DbConnectionPanel } from '../db-connection/Panel';
import { BaseDetail } from './BaseDetail';
import { TableTabs } from './TableTabs';

export const Design = () => {
  const router = useRouter();
  const baseId = router.query.baseId as string;
  const tableId = router.query.tableId as string | undefined;
  const { t } = useTranslation(['table', 'common']);

  const handleBack = () => {
    if (tableId) {
      router.push(`/base/${baseId}/${tableId}`);
    } else {
      router.push(`/base/${baseId}`);
    }
  };

  return (
    <AnchorContext.Provider value={{ baseId }}>
      <TablePermissionProvider baseId={baseId}>
        <div className="h-screen overflow-y-auto bg-background">
          {/* Header */}
          <Head>
            <title>{t('common:noun.design')}</title>
          </Head>
          <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-2 px-4 py-1">
              <Button variant="ghost" size="icon" onClick={handleBack}>
                <ChevronLeft className="size-4" />
              </Button>
              <h1 className="text-lg font-semibold">{t('common:noun.design')}</h1>
            </div>
          </div>

          <div className="space-y-4 p-4 pb-8">
            {/* Top Section: Base Info & Connection */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Base Info */}
              <BaseDetail />

              {/* Connection Info */}
              <DbConnectionPanel />
            </div>

            <Separator />

            <TableTabs />
          </div>
        </div>
      </TablePermissionProvider>
    </AnchorContext.Provider>
  );
};
