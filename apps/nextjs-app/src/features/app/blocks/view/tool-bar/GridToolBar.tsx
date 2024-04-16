import { Plus } from '@teable/icons';
import { useTable, useTablePermission } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { useRouter } from 'next/router';
import { useCallback } from 'react';
import { GridViewOperators } from './components';
import { Others } from './Others';

export const GridToolBar: React.FC = () => {
  const table = useTable();
  const router = useRouter();
  const permission = useTablePermission();

  const addRecord = useCallback(async () => {
    if (!table) {
      return;
    }
    await table.createRecord({}).then((res) => {
      const record = res.data.records[0];

      if (record == null) return;

      const recordId = record.id;

      router.push(
        {
          pathname: router.pathname,
          query: { ...router.query, recordId },
        },
        undefined,
        {
          shallow: true,
        }
      );
    });
  }, [router, table]);

  return (
    <div className="z-49 flex items-center gap-2 border-t px-4 py-2 @container/toolbar">
      <Button
        className="size-6 shrink-0 rounded-full p-0 font-normal"
        size={'xs'}
        variant={'outline'}
        onClick={addRecord}
        disabled={!permission['record|create']}
      >
        <Plus className="size-4" />
      </Button>
      <div className="mx-2 h-4 w-px shrink-0 bg-slate-200"></div>
      <div className="flex flex-1 justify-between">
        <GridViewOperators disabled={!permission['view|update']} />
        <Others />
      </div>
    </div>
  );
};
