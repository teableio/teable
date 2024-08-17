import type { IFilter } from '@teable/core';
import { Filter as FilterIcon } from '@teable/icons';
import { ViewFilter } from '@teable/sdk/components';
import { useTable, useTables, useView, useViews } from '@teable/sdk/hooks';
import { Button, useToast } from '@teable/ui-lib/shadcn';
import { useCallback, useEffect } from 'react';
import z from 'zod';
import { fromZodError } from 'zod-validation-error';
import { Selector } from '@/components/Selector';

export const Pickers: React.FC<{
  setAnchor(anchor: { tableId?: string; viewId?: string }): void;
}> = ({ setAnchor }) => {
  const tables = useTables();
  const table = useTable();

  const views = useViews();
  const view = useView();
  const { toast } = useToast();

  const onFilterChange = useCallback(
    async (filters: IFilter | null) => {
      await view?.updateFilter(filters).catch((e) => {
        let message;
        if (e instanceof z.ZodError) {
          message = fromZodError(e).message;
        } else {
          message = e.message;
        }
        toast({
          variant: 'destructive',
          title: 'Uh oh! Something went wrong.',
          description: message,
        });
      });
    },
    [toast, view]
  );

  useEffect(() => {
    if (!table && tables[0]) {
      setAnchor({ tableId: tables[0].id, viewId: tables[0].defaultViewId });
    }
  }, [setAnchor, table, tables]);

  return (
    <div className="flex items-center gap-2">
      <Selector
        selectedId={table?.id}
        onChange={(tableId) => {
          setAnchor({ tableId, viewId: tables.find(({ id }) => id === tableId)?.defaultViewId });
        }}
        candidates={tables}
        placeholder="Select table..."
      />
      <Selector
        selectedId={view?.id}
        onChange={(viewId) => {
          setAnchor({ tableId: table?.id, viewId });
        }}
        candidates={views}
        placeholder="Select view..."
      />
      <ViewFilter filters={view?.filter as IFilter} onChange={onFilterChange}>
        {(text) => (
          <Button variant={'outline'} className={'font-normal'}>
            <FilterIcon className="size-4 text-sm" />
            <span className="truncate">{text}</span>
          </Button>
        )}
      </ViewFilter>
    </div>
  );
};
