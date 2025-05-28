import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Edit, MoreHorizontal, Plus } from '@teable/icons';
import {
  deleteDashboard,
  duplicateDashboard,
  getDashboardList,
  renameDashboard,
} from '@teable/openapi';
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
  useToast,
} from '@teable/ui-lib/shadcn';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { MenuDeleteItem } from '../components/MenuDeleteItem';
import { useBrand } from '../hooks/useBrand';
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
  const { brandName } = useBrand();
  const { toast } = useToast();

  const { mutate: deleteDashboardMutate } = useMutation({
    mutationFn: () => deleteDashboard(baseId, dashboardId),
    onSuccess: () => {
      setMenuOpen(false);
      queryClient.invalidateQueries(ReactQueryKeys.getDashboardList(baseId));
      router.push({
        pathname: '/base/[baseId]/dashboard',
        query: { baseId },
      });
    },
  });

  const { mutate: duplicateDashboardMutate } = useMutation({
    mutationFn: () =>
      duplicateDashboard(baseId, dashboardId, {
        name: `${selectedDashboard?.name} ${t('common:noun.copy')}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getDashboardList(baseId));
      toast({
        title: t('table:table.actionTips.copySuccessful'),
      });
    },
  });

  const { data: dashboardList } = useQuery({
    queryKey: ReactQueryKeys.getDashboardList(baseId),
    queryFn: ({ queryKey }) => getDashboardList(queryKey[1]).then((res) => res.data),
  });

  const { mutate: renameDashboardMutate } = useMutation({
    mutationFn: () => renameDashboard(baseId, dashboardId, rename!),
    onSuccess: () => {
      setRename(null);
      queryClient.invalidateQueries(ReactQueryKeys.getDashboardList(baseId));
    },
  });

  const selectedDashboard = dashboardList?.find(({ id }) => id === dashboardId);
  const submitRename = () => {
    if (!rename || selectedDashboard?.name === rename) {
      setRename(null);
      return;
    }
    renameDashboardMutate();
  };

  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b px-4">
      <Head>
        <title>
          {selectedDashboard?.name ? `${selectedDashboard?.name} - ${brandName}` : brandName}
        </title>
      </Head>
      <DashboardSwitcher
        className={cn('w-44', {
          hidden: rename !== null,
        })}
        dashboardId={dashboardId}
        onChange={(dashboardId) => {
          router.push({
            pathname: '/base/[baseId]/dashboard',
            query: { baseId, dashboardId },
          });
        }}
      />
      <Input
        ref={renameRef}
        className={cn('w-44', {
          hidden: rename === null,
        })}
        value={rename ?? ''}
        onBlur={() => {
          submitRename();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            submitRename();
          }
          if (e.key === 'Escape') {
            setRename(null);
          }
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
              <DropdownMenuItem onSelect={() => duplicateDashboardMutate()}>
                <Copy className="mr-1.5" />
                {t('common:actions.duplicate')}
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
