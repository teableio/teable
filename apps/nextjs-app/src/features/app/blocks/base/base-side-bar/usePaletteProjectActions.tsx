import { useQuery } from '@tanstack/react-query';
import { ViewType } from '@teable/core';
import { Search, UserPlus } from '@teable/icons';
import type { ICreateBaseNodeRo } from '@teable/openapi';
import { BaseNodeResourceType, getTablePermission } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase, useBasePermission, useTable, useViewId } from '@teable/sdk/hooks';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { BaseInviteDialog } from '@/features/app/components/collaborator/share/ShareBaseDialog';
import { DEFAULT_EMPTY_RECORDS, useDefaultFields } from '../../table-list/useAddTable';
import { VIEW_ICON_MAP } from '../../view/constant';
import { useGridSearchStore } from '../../view/grid/useGridSearchStore';
import { BaseNodeResourceIconMap, getNodeUrl } from '../base-node/hooks/helper';
import { useBaseNodeCreatePermissions } from '../base-node/hooks/useBaseNodeCreatePermissions';
import { useBaseNodeCrud } from '../base-node/hooks/useBaseNodeCrud';
import type { PaletteEntry } from './palette-types';

interface PaletteProjectActionsOptions {
  baseId: string;
  tableId?: string;
  onNavigate: (href: string) => void;
}

const usePaletteViewActions = ({ baseId, tableId, onNavigate }: PaletteProjectActionsOptions) => {
  const { t } = useTranslation(['common', 'table']);
  const table = useTable();
  // The sidebar is outside the page's TablePermissionProvider; share its canonical query.
  const { data: permission } = useQuery({
    queryKey: ReactQueryKeys.getTablePermission(baseId, tableId!),
    queryFn: ({ queryKey }) => getTablePermission(queryKey[1], queryKey[2]).then((res) => res.data),
    enabled: Boolean(tableId),
  });
  if (!table || table.id !== tableId || !permission?.view['view|create']) return [];

  const views = [
    { type: ViewType.Grid, name: t('table:view.category.table') },
    { type: ViewType.Gallery, name: t('table:view.category.gallery') },
    { type: ViewType.Kanban, name: t('table:view.category.kanban') },
    { type: ViewType.Calendar, name: t('table:view.category.calendar') },
    { type: ViewType.Form, name: t('table:view.category.form') },
  ];
  return views.map(({ type, name }): PaletteEntry => {
    const Icon = VIEW_ICON_MAP[type];
    return {
      id: `create-view-${type}`,
      label: t('common:commandPalette.createView', { name }),
      icon: <Icon className="size-4" />,
      keywords: ['create', 'new', 'view', type],
      execute: async () => {
        const { data: view } = await table.createView({ type, name });
        const href = getNodeUrl({
          baseId,
          resourceType: BaseNodeResourceType.Table,
          resourceId: table.id,
          viewId: view.id,
        });
        if (href?.pathname) onNavigate(href.pathname);
      },
    };
  });
};

const usePaletteSearchAction = (tableId?: string) => {
  const { t } = useTranslation('common');
  const viewId = useViewId();
  const searchTarget = useGridSearchStore((state) => state.searchTarget);
  if (!searchTarget || searchTarget.tableId !== tableId || searchTarget.viewId !== viewId) return;

  return (query: string): PaletteEntry => ({
    id: 'search-table',
    label: query
      ? t('commandPalette.searchTableQuery', { query })
      : t('commandPalette.currentTable'),
    description: query,
    icon: <Search className="size-4" />,
    keywords: ['search', 'find', 'records'],
    execute: () => {
      // Never deliver an old command to a newly mounted table or view.
      if (useGridSearchStore.getState().searchTarget === searchTarget) searchTarget.open(query);
    },
  });
};

const usePaletteTableCreation = (
  allowed: boolean,
  createNode: (params: ICreateBaseNodeRo) => Promise<void>
) => {
  const { t } = useTranslation(['common', 'table']);
  const fields = useDefaultFields();
  if (!allowed) return;

  return (name: string): PaletteEntry => ({
    id: 'create-table',
    label: name
      ? t('common:commandPalette.createTableQuery', { name })
      : t('table:table.operator.createBlank'),
    description: name,
    icon: <BaseNodeResourceIconMap.table className="size-4" />,
    keywords: ['create', 'new', 'table', '新建表', '创建表'],
    execute: () =>
      createNode({
        resourceType: BaseNodeResourceType.Table,
        name: name || t('table:table.newTableLabel'),
        fields,
        views: [{ name: t('table:view.category.table'), type: ViewType.Grid }],
        records: DEFAULT_EMPTY_RECORDS,
      }),
  });
};

// Base-only: the sidebar has TableProvider, but deliberately has no ViewProvider.
export const usePaletteProjectActions = ({
  baseId,
  tableId,
  onNavigate,
}: PaletteProjectActionsOptions) => {
  const { t } = useTranslation(['common', 'table', 'space']);
  const base = useBase();
  const basePermission = useBasePermission();
  const viewCommands = usePaletteViewActions({ baseId, tableId, onNavigate });
  const makeSearchTable = usePaletteSearchAction(tableId);
  const permissions = useBaseNodeCreatePermissions();
  const [inviteOpen, setInviteOpen] = useState(false);
  const { createNode } = useBaseNodeCrud({
    onCreateSuccess: (node) => {
      const href = getNodeUrl({
        baseId,
        resourceType: node.resourceType,
        resourceId: node.resourceId,
        viewId:
          node.resourceType === BaseNodeResourceType.Table
            ? node.resourceMeta?.defaultViewId
            : undefined,
      });
      if (href?.pathname) onNavigate(href.pathname);
      else toast.success(t('common:commandPalette.folderCreated'));
    },
  });
  const commands: PaletteEntry[] = [];
  const makeCreateTable = usePaletteTableCreation(permissions.canCreateTable, createNode);
  if (makeCreateTable) commands.push(makeCreateTable(''));

  const resources = [
    {
      type: BaseNodeResourceType.Dashboard,
      allowed: permissions.canCreateDashboard,
      label: t('common:commandPalette.createDashboard'),
      name: t('common:noun.dashboard'),
    },
    {
      type: BaseNodeResourceType.App,
      allowed: permissions.canCreateApp,
      label: t('common:commandPalette.createApp'),
      name: t('common:noun.newApp'),
    },
    {
      type: BaseNodeResourceType.Workflow,
      allowed: permissions.canCreateWorkflow,
      label: t('common:commandPalette.createWorkflow'),
      name: t('common:noun.newAutomation'),
    },
    {
      type: BaseNodeResourceType.Routine,
      allowed: permissions.canCreateRoutine,
      label: t('common:commandPalette.createRoutine'),
      name: t('common:noun.newRoutine'),
    },
    {
      type: BaseNodeResourceType.Folder,
      allowed: permissions.canCreateFolder,
      label: t('common:commandPalette.createFolder'),
      name: t('common:noun.newFolder'),
    },
  ] as const;
  for (const { type, allowed, label, name } of resources) {
    if (!allowed) continue;
    const Icon = BaseNodeResourceIconMap[type];
    commands.push({
      id: `create-${type}`,
      label,
      icon: <Icon className="size-4" />,
      keywords: ['create', 'new', type],
      execute: () => createNode({ resourceType: type, name }),
    });
  }

  commands.push(...viewCommands);

  const canInvite = Boolean(
    basePermission?.['base|invite_email'] || basePermission?.['base|invite_link']
  );
  if (canInvite)
    commands.push({
      id: 'invite',
      label: t('common:commandPalette.invite'),
      icon: <UserPlus className="size-4" />,
      keywords: ['invite', 'member', 'collaborator'],
      execute: () => setInviteOpen(true),
    });

  if (makeSearchTable) commands.push(makeSearchTable(''));

  return {
    commands,
    makeCreateTable,
    makeSearchTable,
    overlays:
      canInvite && inviteOpen ? (
        <BaseInviteDialog base={base} open={inviteOpen} onOpenChange={setInviteOpen} />
      ) : null,
  };
};
