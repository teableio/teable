import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Edit, MoreHorizontal, Plus } from '@teable/icons';
import {
  deleteDashboard,
  duplicateDashboard,
  getDashboard,
  renameDashboard,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef, useState } from 'react';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { MenuDeleteItem } from '../components/MenuDeleteItem';
import { useBrand } from '../hooks/useBrand';
import { AddPluginDialog } from './components/AddPluginDialog';

export const DashboardHeader = (props: { dashboardId: string }) => {
  const { dashboardId } = props;
  const baseId = useBaseId()!;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState<string>('');
  const renameRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  const basePermissions = useBasePermission();
  const canManage = basePermissions?.['base|update'];
  const { brandName } = useBrand();

  const { data: dashboard } = useQuery({
    queryKey: ReactQueryKeys.getDashboard(dashboardId),
    queryFn: () => getDashboard(baseId, dashboardId).then((res) => res.data),
  });

  const { mutate: deleteDashboardMutate } = useMutation({
    mutationFn: () => deleteDashboard(baseId, dashboardId),
    onSuccess: () => {
      setMenuOpen(false);
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getDashboardList(baseId) });
      router.push(`/base/${baseId}/dashboard`);
    },
  });

  const { mutate: duplicateDashboardMutate } = useMutation({
    mutationFn: () =>
      duplicateDashboard(baseId, dashboardId, {
        name: `${dashboard?.name} ${t('common:noun.copy')}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getDashboardList(baseId) });
      toast.success(t('table:table.actionTips.copySuccessful'));
    },
  });

  const { mutate: renameDashboardMutate } = useMutation({
    mutationFn: ({ name }: { name: string }) => renameDashboard(baseId, dashboardId, name),
    onSuccess: () => {
      setIsRenaming(false);
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getDashboard(dashboardId) });
    },
  });

  const dashboardName = dashboard?.name ?? t('common:noun.dashboard');

  const startRename = () => {
    setIsRenaming(true);
    setEditName(dashboardName);
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setEditName(dashboardName);
  };

  const submitRename = () => {
    const newName = editName.trim();
    if (dashboardName === newName) {
      setIsRenaming(false);
      return;
    }
    setIsRenaming(false);
    renameDashboardMutate({ name: newName });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      submitRename();
    } else if (e.key === 'Escape') {
      cancelRename();
    }
  };

  useEffect(() => {
    if (isRenaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [isRenaming]);

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
      <Head>
        <title>{dashboardName ? `${dashboardName} - ${brandName}` : brandName}</title>
      </Head>
      {isRenaming ? (
        <Input
          ref={renameRef}
          className="max-w-60"
          value={editName ?? ''}
          onBlur={submitRename}
          onKeyDown={handleKeyDown}
          onChange={(e) => setEditName(e.target.value)}
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-sm"
          disabled={!canManage}
          onClick={startRename}
        >
          <span className="truncate"> {dashboardName}</span>
        </Button>
      )}

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
              <DropdownMenuItem onSelect={startRename}>
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
