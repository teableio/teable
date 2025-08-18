import { ViewType } from '@teable/core';
import { Check, Table2, X, Lock } from '@teable/icons';
import type { IChatContext } from '@teable/openapi';
import { AnchorContext, ViewProvider } from '@teable/sdk/context';
import { useIsMobile, useTables, useViews } from '@teable/sdk/hooks';
import type { Table } from '@teable/sdk/model';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Skeleton,
} from '@teable/ui-lib/shadcn';
import { Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn/ui/dialog';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { Fragment, useMemo, useState } from 'react';
import { VIEW_ICON_MAP } from '@/features/app/blocks/view/constant';
import { Emoji } from '../../emoji/Emoji';
import { useChatContext } from '../context/useChatContext';

const SelectedViewNameMap: Record<string, string> = {};

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
      tables: context?.tables?.filter(({ id }) => id !== tableId),
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
            className="h-6 justify-between gap-0.5 border bg-slate-100 px-1.5 font-normal text-muted-foreground dark:border-zinc-700 dark:bg-zinc-700"
          >
            <span className="text-xs">@</span>
            {!context?.tables?.length && (
              <span className="text-xs">{t('table:aiChat.context.button')}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
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
                    <ViewMenu
                      key={table.id}
                      table={table}
                      selectedViewId={context?.tables?.find(({ id }) => id === table.id)?.viewId}
                      onSelect={(viewId) => {
                        if (context?.tables?.some(({ id }) => id === table.id)) {
                          setContext({
                            ...context,
                            tables: context?.tables?.map(({ id, viewId: oldViewId }) =>
                              id === table.id
                                ? { id, viewId: oldViewId === viewId ? undefined : viewId }
                                : { id }
                            ),
                          });
                        } else {
                          setContext({
                            ...context,
                            tables: [...(context?.tables || []), { id: table.id, viewId }],
                          });
                        }
                      }}
                    >
                      <CommandItem
                        className="flex-1 gap-2 text-xs"
                        key={table.id}
                        value={table.name}
                        onSelect={() => {
                          if (context?.tables?.some(({ id }) => id === table.id)) {
                            setContext({
                              ...context,
                              tables: context?.tables?.filter(({ id }) => id !== table.id),
                            });
                          } else {
                            setContext({
                              ...context,
                              tables: [...(context?.tables || []), { id: table.id }],
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
                        {context?.tables?.some(({ id }) => id === table.id) && (
                          <Check className="size-4 shrink-0" />
                        )}
                      </CommandItem>
                    </ViewMenu>
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
  const { tables } = context;

  return (
    <>
      {tables?.map(({ id, viewId }) => {
        const table = tableMap[id];
        if (!table) return;
        const viewName = viewId ? SelectedViewNameMap[viewId] : '';
        return (
          <div
            key={id}
            className="group flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded border border-zinc-200 px-1 text-xs text-muted-foreground dark:border-zinc-700"
          >
            <div className="md:group-hover:hidden">
              {table.icon ? (
                <Emoji className="w-auto shrink-0" emoji={table.icon} size={'0.7rem'} />
              ) : (
                <Table2 className="size-3 shrink-0" />
              )}
            </div>
            <button
              type="button"
              className="group-hover:block md:hidden"
              onClick={() => {
                onTableIdDelete?.(id);
              }}
            >
              <X className="size-3 shrink-0" />
            </button>
            {table.name}
            {viewName && (
              <span className="text-xs text-muted-foreground">
                {' '}
                - {viewName.length > 10 ? viewName.slice(0, 10) + '...' : viewName}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
};

const ViewMenu = ({
  table,
  children,
  selectedViewId,
  onSelect,
}: {
  table: Table;
  children: React.ReactNode;
  selectedViewId?: string;
  onSelect: (viewId: string) => void;
}) => {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation(['common']);
  if (isMobile) {
    return (
      <Dialog
        open={open}
        onOpenChange={(open) => {
          if (!open) {
            setOpen(false);
          }
        }}
      >
        <DialogTrigger asChild>
          <div className="flex w-full items-center gap-1">
            {children}
            <Button
              className="p-0 font-normal"
              size={'xs'}
              variant={'link'}
              onClick={() => setOpen(true)}
            >
              {t('common:noun.view')}
            </Button>
          </div>
        </DialogTrigger>
        <DialogContent>
          <AnchorContext.Provider value={{ tableId: table.id }}>
            <ViewProvider>
              <ViewList
                selectedViewId={selectedViewId}
                onSelect={(viewId) => {
                  onSelect(viewId);
                  setOpen(false);
                }}
              />
            </ViewProvider>
          </AnchorContext.Provider>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <HoverCard openDelay={200} closeDelay={50}>
      <HoverCardTrigger>{children}</HoverCardTrigger>
      <HoverCardContent side="right" className="w-64 p-1">
        <AnchorContext.Provider value={{ tableId: table.id }}>
          <ViewProvider>
            <ViewList selectedViewId={selectedViewId} onSelect={onSelect} />
          </ViewProvider>
        </AnchorContext.Provider>
      </HoverCardContent>
    </HoverCard>
  );
};

const ViewList = ({
  selectedViewId,
  onSelect,
}: {
  selectedViewId?: string;
  onSelect: (viewId: string) => void;
}) => {
  const { t } = useTranslation(['table']);
  const views = useViews();
  if (!views.length)
    return (
      <div className="flex flex-col gap-2 p-2">
        <Skeleton className="h-6 w-full" />
      </div>
    );

  return (
    <Command className="w-full">
      <CommandInput className="text-xs" placeholder={t('table:view.searchView')} />
      <CommandList className="mt-2">
        {views.map((view) => {
          const ViewIcon = VIEW_ICON_MAP[view.type];
          return (
            <CommandItem
              key={view.id}
              className="justify-between text-xs"
              onSelect={() => {
                onSelect(view.id);
                SelectedViewNameMap[view.id] = view.name;
              }}
            >
              <div className="flex items-center gap-0.5">
                {view.type === ViewType.Plugin ? (
                  <Image
                    className="mr-1 size-4 shrink-0"
                    width={16}
                    height={16}
                    src={view.options.pluginLogo}
                    alt={view.name}
                  />
                ) : (
                  <Fragment>
                    {view.isLocked && <Lock className="mr-[2px] size-4 shrink-0" />}
                    <ViewIcon className="mr-1 size-4 shrink-0" />
                  </Fragment>
                )}

                {view.name}
              </div>
              {view.id === selectedViewId && <Check className="size-4 shrink-0" />}
            </CommandItem>
          );
        })}
      </CommandList>
    </Command>
  );
};
