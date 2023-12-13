import { LocalStorageKeys } from '@teable-group/sdk/config/local-storage-keys';
import { AnchorProvider } from '@teable-group/sdk/context';
import { useBase, useTables } from '@teable-group/sdk/hooks';
import { Tabs, TabsList, TabsTrigger } from '@teable-group/ui-lib/shadcn';
import { useEffect, useMemo } from 'react';
import { useLocalStorage } from 'react-use';
import { Pickers } from './components/Pickers';
import { GridContent } from './GridContent';

export function DashboardPage() {
  const base = useBase();
  const tables = useTables();
  const [anchor, setAnchor] = useLocalStorage<{ tableId?: string; viewId?: string }>(
    LocalStorageKeys.DashboardKey + base.id
  );

  const existTable = useMemo(
    () => tables.find((t) => t.id === anchor?.tableId),
    [anchor?.tableId, tables]
  );

  useEffect(() => {
    if (!existTable) {
      setAnchor({});
    }
  }, [existTable, setAnchor, tables]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { viewId, tableId } = existTable && anchor ? anchor : ({} as any);

  return (
    <AnchorProvider viewId={viewId} tableId={tableId}>
      <div className="h-full flex-col md:flex">
        <div className="flex h-full flex-1 flex-col gap-2 lg:gap-4">
          <div className="items-center justify-between space-y-2 px-8 pb-2 pt-6 lg:flex">
            <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
            <Pickers setAnchor={setAnchor} />
          </div>
          <Tabs defaultValue="overview" className="overflow-y-auto">
            <div className="sticky top-0 z-[1] bg-background px-8 pb-4">
              <TabsList className="shrink-0">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="analytics" disabled>
                  Analytics
                </TabsTrigger>
                <TabsTrigger value="reports" disabled>
                  Reports
                </TabsTrigger>
                <TabsTrigger value="notifications" disabled>
                  Notifications
                </TabsTrigger>
              </TabsList>
            </div>
            <GridContent />
          </Tabs>
        </div>
      </div>
    </AnchorProvider>
  );
}
