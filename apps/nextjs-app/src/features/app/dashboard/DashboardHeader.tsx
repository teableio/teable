import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit, MoreHorizontal, Plus } from '@teable/icons';
import { deleteDashboard, getDashboardList, renameDashboard } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { MenuDeleteItem } from '../components/MenuDeleteItem';
import { AddPluginDialog } from './components/AddPluginDialog';
import { DashboardSwitcher } from './components/DashboardSwitcher';

export const DashboardHeader = (props: { dashboardId: string }) => {
  const { dashboardId } = props;
  const baseId = useBaseId()!;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  const basePermissions = useBasePermission();
  const canManage = basePermissions?.['base|update'];

  const { mutate: deleteDashboardMutate } = useMutation({
    mutationFn: () => deleteDashboard(baseId, dashboardId),
    onSuccess: () => {
      setMenuOpen(false);
      queryClient.invalidateQueries(ReactQueryKeys.getDashboardList());
      router.push(`/base/${baseId}/dashboard`);
    },
  });

  const { data: dashboardList } = useQuery({
    queryKey: ReactQueryKeys.getDashboardList(),
    queryFn: () => getDashboardList(baseId).then((res) => res.data),
  });

  const { mutate: renameDashboardMutate } = useMutation({
    mutationFn: () => renameDashboard(baseId, dashboardId, rename!),
    onSuccess: () => {
      setRename(null);
      queryClient.invalidateQueries(ReactQueryKeys.getDashboardList());
    },
  });

  const selectedDashboard = dashboardList?.find(({ id }) => id === dashboardId);

  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b px-4">
      <DashboardSwitcher
        className={cn('w-44', {
          hidden: rename !== null,
        })}
        dashboardId={dashboardId}
        onChange={(dashboardId) => {
          router.push(`/base/${baseId}/dashboard?id=${dashboardId}`);
        }}
      />
      <Input
        ref={renameRef}
        className={cn('w-44', {
          hidden: rename === null,
        })}
        value={rename ?? ''}
        onBlur={() => {
          if (!rename || selectedDashboard?.name === rename) {
            setRename(null);
            return;
          }
          renameDashboardMutate();
        }}
        onChange={(e) => setRename(e.target.value)}
      />
      <div className="flex items-center gap-2">
        {canManage && (
          <AddPluginDialog dashboardId={dashboardId}>
            <Button variant={'outline'} size={'xs'}>
              <Plus />
              {t('dashboard:addPlugin')}
            </Button>
          </AddPluginDialog>
        )}
        {canManage && (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="outline" className="size-7">
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="relative min-w-36 overflow-hidden">
              <DropdownMenuItem
                onSelect={() => {
                  setRename(selectedDashboard?.name ?? null);
                  setTimeout(() => renameRef.current?.focus(), 200);
                }}
              >
                <Edit className="mr-1.5" />
                {t('common:actions.rename')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <MenuDeleteItem onConfirm={deleteDashboardMutate} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
};
