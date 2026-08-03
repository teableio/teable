import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, PlusCircle } from '@teable/icons';
import { listPluginPanels } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTablePermission } from '@teable/sdk/hooks';
import {
  Button,
  cn,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import type { ICreatePluginPanelDialogRef } from './components/CreatePluginPanelDialog';
import { CreatePluginPanelDialog } from './components/CreatePluginPanelDialog';
import { useActivePluginPanelId } from './hooks/useActivePluginPanelId';
import { usePluginPanelStorage } from './hooks/usePluginPanelStorage';

export const PluginPanelSelector = ({
  tableId,
  className,
}: {
  tableId: string;
  className?: string;
}) => {
  const { touchActivePanel } = usePluginPanelStorage(tableId);
  const activePluginPanelId = useActivePluginPanelId(tableId);
  const [open, setOpen] = useState(false);
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const createPluginPanelDialogRef = useRef<ICreatePluginPanelDialogRef>(null);

  const { data: pluginPanels } = useQuery({
    queryKey: ReactQueryKeys.getPluginPanelList(tableId),
    queryFn: ({ queryKey }) => listPluginPanels(queryKey[1]).then((res) => res.data),
  });

  const tablePermissions = useTablePermission();
  const canManage = tablePermissions?.['table|update'];
  const activePluginPanel = pluginPanels?.find(({ id }) => id === activePluginPanelId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          size={'xs'}
          aria-expanded={open}
          aria-label="Select a team"
          className={cn('justify-between overflow-hidden', className)}
        >
          <span className="truncate">{activePluginPanel?.name}</span>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] rounded-lg bg-background p-1 shadow-lg ring-1 ring-background/5">
        <Command>
          <CommandInput placeholder={t('sdk:common.search.placeholder')} />
          <CommandList>
            <CommandEmpty>{t('sdk:common.search.empty')}</CommandEmpty>
            <CommandGroup>
              {pluginPanels?.map(({ id, name }) => (
                <CommandItem
                  key={id}
                  onSelect={() => {
                    if (id !== activePluginPanelId) {
                      touchActivePanel(id);
                      setOpen(false);
                    }
                  }}
                  className="text-sm"
                >
                  {name}
                  <Check
                    className={cn(
                      'ml-auto h-4 w-4',
                      activePluginPanelId === id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {canManage && (
            <>
              <CommandSeparator />
              <CommandList>
                <CommandGroup>
                  <CreatePluginPanelDialog
                    ref={createPluginPanelDialogRef}
                    tableId={tableId}
                    onClose={() => setOpen(false)}
                  >
                    <CommandItem
                      onSelect={() => {
                        createPluginPanelDialogRef.current?.open();
                      }}
                    >
                      <PlusCircle className="mr-2 size-5" />
                      {t('table:pluginPanel.createPluginPanel.button')}
                    </CommandItem>
                  </CreatePluginPanelDialog>
                </CommandGroup>
              </CommandList>
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
};
