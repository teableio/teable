import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, PlusCircle } from '@teable/icons';
import { getDashboardList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
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
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import type { ICreateDashboardDialogRef } from './CreateDashboardDialog';
import { CreateDashboardDialog } from './CreateDashboardDialog';

export const DashboardSwitcher = (props: {
  className?: string;
  dashboardId: string;
  onChange?: (dashboardId: string) => void;
}) => {
  const { className, dashboardId } = props;
  const [open, setOpen] = useState(false);
  const baseId = useBaseId()!;
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  const createDashboardDialogRef = useRef<ICreateDashboardDialogRef>(null);
  const { data: dashboardList } = useQuery({
    queryKey: ReactQueryKeys.getDashboardList(baseId),
    queryFn: ({ queryKey }) => getDashboardList(queryKey[1]).then((res) => res.data),
  });
  const basePermissions = useBasePermission();
  const canManage = basePermissions?.['base|update'];

  const selectedDashboard = dashboardList?.find(({ id }) => id === dashboardId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          size={'sm'}
          aria-expanded={open}
          aria-label="Select a team"
          className={cn('w-[200px] justify-between', className)}
        >
          <span className="truncate">{selectedDashboard?.name}</span>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput placeholder={t('dashboard:findDashboard')} />
          <CommandList>
            <CommandEmpty>{t('common.search.empty')}</CommandEmpty>
            <CommandGroup>
              {dashboardList?.map(({ id, name }) => (
                <CommandItem
                  key={id}
                  onSelect={() => {
                    if (id !== dashboardId) {
                      props.onChange?.(id);
                      setOpen(false);
                    }
                  }}
                  className="text-sm"
                >
                  {name}
                  <Check
                    className={cn(
                      'ml-auto h-4 w-4',
                      dashboardId === id ? 'opacity-100' : 'opacity-0'
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
                  <CreateDashboardDialog
                    ref={createDashboardDialogRef}
                    onSuccessCallback={() => setOpen(false)}
                  >
                    <CommandItem
                      onSelect={() => {
                        createDashboardDialogRef.current?.open();
                      }}
                    >
                      <PlusCircle className="mr-2 size-5" />
                      {t('dashboard:createDashboard.button')}
                    </CommandItem>
                  </CreateDashboardDialog>
                </CommandGroup>
              </CommandList>
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
};
