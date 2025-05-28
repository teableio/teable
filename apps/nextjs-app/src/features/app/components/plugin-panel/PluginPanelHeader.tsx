import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Edit, MoreHorizontal, Plus, X } from '@teable/icons';
import {
  deletePluginPanel,
  duplicatePluginPanel,
  listPluginPanels,
  renamePluginPanel,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTablePermission } from '@teable/sdk/hooks';
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
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { MenuDeleteItem } from '../MenuDeleteItem';
import { CreatePluginDialog } from './components/CreatePluginDialog';
import { useActivePluginPanelId } from './hooks/useActivePluginPanelId';
import { usePluginPanelStorage } from './hooks/usePluginPanelStorage';
import { PluginPanelSelector } from './PluginPanelSelector';

export const PluginPanelHeader = (props: { tableId: string }) => {
  const { tableId } = props;
  const { toggleVisible } = usePluginPanelStorage(tableId);
  const [menuOpen, setMenuOpen] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const [rename, setRename] = useState<string | null>(null);
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const queryClient = useQueryClient();
  const tablePermissions = useTablePermission();
  const canManage = tablePermissions?.['table|update'];
  const activePluginPanelId = useActivePluginPanelId(tableId)!;
  const { toast } = useToast();

  const { data: pluginPanels } = useQuery({
    queryKey: ReactQueryKeys.getPluginPanelList(tableId),
    queryFn: ({ queryKey }) => listPluginPanels(queryKey[1]).then((res) => res.data),
  });

  const activePluginPanel = pluginPanels?.find(({ id }) => id === activePluginPanelId);

  const { mutate: deletePluginPanelMutate } = useMutation({
    mutationFn: () => deletePluginPanel(tableId, activePluginPanelId),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getPluginPanelList(tableId));
    },
  });

  const { mutate: renamePluginPanelMutate } = useMutation({
    mutationFn: (name: string) => renamePluginPanel(tableId, activePluginPanelId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getPluginPanelList(tableId));
      setRename(null);
    },
  });

  const { mutate: duplicatePluginPanelMutate } = useMutation({
    mutationFn: (name: string) =>
      duplicatePluginPanel(tableId, activePluginPanelId, {
        name: `${name} ${t('common:noun.copy')}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getPluginPanelList(tableId));
      setRename(null);
      toast({
        title: t('table:table.actionTips.copySuccessful'),
      });
    },
  });

  const onRenameSubmit = () => {
    if (!rename || activePluginPanel?.name === rename) {
      setRename(null);
      return;
    }
    renamePluginPanelMutate(rename);
  };

  return (
    <div className="relative flex h-[43px] shrink-0 items-center justify-between gap-2 border-b px-2 @container/plugin-panel-header">
      <PluginPanelSelector tableId={tableId} />
      <Input
        ref={renameRef}
        className={cn('absolute h-7 left-0 right-0', {
          hidden: rename === null,
        })}
        value={rename ?? ''}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onRenameSubmit();
          }
          if (e.key === 'Escape') {
            setRename(null);
          }
        }}
        onBlur={() => {
          onRenameSubmit();
        }}
        onChange={(e) => setRename(e.target.value)}
      />
      <div className="flex gap-1">
        <CreatePluginDialog tableId={tableId}>
          <Button variant="outline" size="xs">
            <Plus />
            <span className="hidden @xs/plugin-panel-header:inline">{t('table:addPlugin')}</span>
          </Button>
        </CreatePluginDialog>
        {canManage && (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs">
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="relative min-w-36 overflow-hidden">
              <DropdownMenuItem
                onSelect={() => {
                  setRename(activePluginPanel?.name ?? null);
                  setTimeout(() => renameRef.current?.focus(), 200);
                }}
              >
                <Edit className="mr-1.5" />
                {t('common:actions.rename')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (activePluginPanel?.name) {
                    duplicatePluginPanelMutate(activePluginPanel.name);
                  }
                }}
              >
                <Copy className="mr-1.5" />
                {t('common:actions.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <MenuDeleteItem onConfirm={deletePluginPanelMutate} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button variant="outline" size="xs" onClick={toggleVisible}>
          <X />
        </Button>
      </div>
    </div>
  );
};
