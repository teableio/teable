import { Check, Table2, X } from '@teable/icons';
import type { IChatContext } from '@teable/openapi';
import { useTables } from '@teable/sdk/hooks';
import type { Table } from '@teable/sdk/model';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { Emoji } from '../../emoji/Emoji';
import { useChatContext } from '../context/useChatContext';

export const MessageContext = () => {
  const { context, setContext } = useChatContext();
  const tables = useTables();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation(['table', 'common']);
  const tableMap = useMemo(() => {
    return tables.reduce(
      (acc, table) => {
        acc[table.id] = table;
        return acc;
      },
      {} as Record<string, Table>
    );
  }, [tables]);

  const onTableIdDelete = (tableId: string) => {
    setContext({
      ...context,
      tableIds: context?.tableIds?.filter((id) => id !== tableId),
    });
  };

  return (
    <div className="flex max-h-14 flex-wrap items-center gap-1 overflow-y-auto">
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            size="xs"
            className="h-6 justify-between gap-0.5 border border-zinc-200 bg-muted px-1.5 font-normal text-muted-foreground dark:border-zinc-700"
          >
            <span className="text-xs">@</span>
            {!context?.tableIds?.length && (
              <span className="text-xs">{t('table:aiChat.context.button')}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0">
          <Command>
            <CommandInput className="text-xs" placeholder={t('table:aiChat.context.search')} />
            <CommandEmpty className="py-5 text-center text-xs text-muted-foreground">
              {tables.length === 0
                ? t('table:aiChat.context.emptyContext')
                : t('table:aiChat.context.searchEmpty')}
            </CommandEmpty>
            <ScrollArea className="w-full">
              <CommandList>
                <CommandGroup heading={t('common:noun.table')}>
                  {tables.map((table) => (
                    <CommandItem
                      className="gap-2 text-xs"
                      key={table.id}
                      value={table.name}
                      onSelect={() => {
                        if (context?.tableIds?.includes(table.id)) {
                          setContext({
                            ...context,
                            tableIds: context?.tableIds?.filter((id) => id !== table.id),
                          });
                        } else {
                          setContext({
                            ...context,
                            tableIds: [...(context?.tableIds || []), table.id],
                          });
                        }
                      }}
                    >
                      {table.icon ? (
                        <Emoji className="w-auto shrink-0" emoji={table.icon} size={'0.8rem'} />
                      ) : (
                        <Table2 className="size-4 shrink-0" />
                      )}
                      <span className="grow truncate">{table.name}</span>
                      {context?.tableIds?.includes(table.id) && (
                        <Check className="size-4 shrink-0" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </ScrollArea>
          </Command>
        </PopoverContent>
      </Popover>
      {context && (
        <ContextItem context={context} tableMap={tableMap} onTableIdDelete={onTableIdDelete} />
      )}
    </div>
  );
};

const ContextItem = ({
  context,
  tableMap,
  onTableIdDelete,
}: {
  context: IChatContext;
  tableMap: Record<string, Table>;
  onTableIdDelete?: (tableId: string) => void;
}) => {
  const { tableIds } = context;

  return (
    <>
      {tableIds?.map((tableId) => {
        const table = tableMap[tableId];
        if (!table) return;
        return (
          <div
            key={tableId}
            className="group flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded border border-zinc-200 px-1 text-xs text-muted-foreground dark:border-zinc-700"
          >
            <div className="group-hover:hidden">
              {table.icon ? (
                <Emoji className="w-auto shrink-0" emoji={table.icon} size={'0.7rem'} />
              ) : (
                <Table2 className="size-3 shrink-0" />
              )}
            </div>
            <button
              type="button"
              className="hidden group-hover:block"
              onClick={() => {
                onTableIdDelete?.(tableId);
              }}
            >
              <X className="size-3 shrink-0" />
            </button>
            {table.name}
          </div>
        );
      })}
    </>
  );
};
