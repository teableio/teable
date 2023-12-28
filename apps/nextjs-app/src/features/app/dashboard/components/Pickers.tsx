import { Filter as FilterIcon } from '@teable-group/icons';
import type { IFilter } from '@teable-group/sdk/components';
import { Filter } from '@teable-group/sdk/components';
import { useTable, useTables, useView, useViews } from '@teable-group/sdk/hooks';
import { Selector } from '@teable-group/ui-lib/base';
import { Button, useToast } from '@teable-group/ui-lib/shadcn';
import { useCallback, useEffect } from 'react';
import z from 'zod';
import { fromZodError } from 'zod-validation-error';

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
      await view?.setViewFilter(filters).catch((e) => {
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
      <Filter filters={view?.filter as IFilter} onChange={onFilterChange}>
        {(text) => (
          <Button variant={'outline'} className={'font-normal'}>
            <FilterIcon className="h-4 w-4 text-sm" />
            <span className="truncate">{text}</span>
          </Button>
        )}
      </Filter>
    </div>
  );
};
