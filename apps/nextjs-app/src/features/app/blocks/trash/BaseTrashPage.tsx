import type { QueryFunctionContext } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { ITrashItemVo, ITrashVo } from '@teable/openapi';
import {
  getTrashItems,
  PrincipalType,
  resetTrashItems,
  restoreTrash,
  TrashType,
} from '@teable/openapi';
import { InfiniteTable } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId, useBasePermission, useIsHydrated } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import dayjs from 'dayjs';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Head from 'next/head';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { useBrand } from '@/features/app/hooks/useBrand';
import { useEnv } from '@/features/app/hooks/useEnv';
import { spaceConfig } from '@/features/i18n/space.config';
import { Collaborator } from '../../components/collaborator-manage/components/Collaborator';
import { useIsCommunity } from '../../hooks/useIsCommunity';

type ITrashRow = ITrashItemVo & { depth: number };

/** Every page of the entries directly under a trashed folder. */
const getFolderTrashItems = async (folderId: string) => {
  const items: ITrashItemVo[] = [];
  let resourceMap: ITrashVo['resourceMap'] = {};
  let userMap: ITrashVo['userMap'] = {};
  let cursor: string | undefined;
  do {
    const { data } = await getTrashItems({
      resourceType: TrashType.Folder,
      resourceId: folderId,
      cursor,
      pageSize: 20,
    });
    items.push(...(data.trashItems as ITrashItemVo[]));
    resourceMap = { ...resourceMap, ...data.resourceMap };
    userMap = { ...userMap, ...data.userMap };
    cursor = data.nextCursor ?? undefined;
  } while (cursor);
  return { items, resourceMap, userMap };
};

export const BaseTrashPage = () => {
  const baseId = useBaseId() as string;
  const isHydrated = useIsHydrated();
  const queryClient = useQueryClient();
  const permission = useBasePermission();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const { brandName } = useBrand();
  const isCommunity = useIsCommunity();
  const { trash } = useEnv();
  const retentionDays = trash?.retentionDays ?? 0;
  const [userMap, setUserMap] = useState<ITrashVo['userMap']>({});
  const [resourceMap, setResourceMap] = useState<ITrashVo['resourceMap']>({});
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [isConfirmVisible, setConfirmVisible] = useState(false);
  // A trashed folder lists its own contents when expanded, each entry restorable on its own.
  const [folderItems, setFolderItems] = useState<Record<string, ITrashItemVo[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const loadFolder = useCallback(async (folderId: string) => {
    const loaded = await getFolderTrashItems(folderId);
    setUserMap((prev) => ({ ...prev, ...loaded.userMap }));
    setResourceMap((prev) => ({ ...prev, ...loaded.resourceMap }));
    setFolderItems((prev) => ({ ...prev, [folderId]: loaded.items }));
    return loaded;
  }, []);

  const toggleFolder = useCallback(
    (folderId: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderId)) {
          next.delete(folderId);
        } else {
          next.add(folderId);
          void loadFolder(folderId);
        }
        return next;
      });
    },
    [loadFolder]
  );

  const queryFn = async ({ queryKey, pageParam }: QueryFunctionContext) => {
    const res = await getTrashItems({
      resourceType: TrashType.Base,
      resourceId: queryKey[1] as string,
      cursor: pageParam as string | undefined,
      pageSize: 20,
    });
    const {
      trashItems,
      nextCursor: newNextCursor,
      userMap: newUserMap,
      resourceMap: newResourceMap,
    } = res.data;

    setNextCursor(newNextCursor);
    setUserMap((prev) => ({ ...prev, ...newUserMap }));
    setResourceMap((prev) => ({ ...prev, ...newResourceMap }));

    return trashItems;
  };

  const { data, isFetching, isLoading, fetchNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.getTrashItems(baseId),
    queryFn,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: () => nextCursor ?? undefined,
  });

  // mutate, not mutateAsync: a failed restore or reset is reported by the global error toast.
  const { mutate: mutateRestore } = useMutation({
    mutationFn: async (props: { trashId: string; resourceType: string; resourceId: string }) => {
      const { data } = await restoreTrash(props.trashId);
      // Each trashed resource's name is in the map every page of the trash returns.
      return data.restored.map((item) => ({
        resourceType: item.resourceType,
        name: resourceMap[item.resourceId]?.name ?? '',
      }));
    },
    // A folder restore that fails part way has still brought some of it back.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getTrashItems(baseId) });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseNodeTree(baseId) });
      // Open folders stay open, so the rest of their contents can be restored one by one.
      expandedFolders.forEach((folderId) => void loadFolder(folderId).catch(() => undefined));
    },
    onSuccess: (contents) => {
      const namesOf = (...types: string[]) =>
        contents
          .filter((item) => types.includes(item.resourceType))
          .map((item) => item.name)
          .join(', ');
      const inactive = namesOf(TrashType.Workflow, TrashType.Routine);
      const unpublished = namesOf(TrashType.App);
      const notes = [
        inactive && t('common:trash.restoredInactive', { names: inactive }),
        unpublished && t('common:trash.restoredUnpublished', { names: unpublished }),
      ].filter(Boolean);
      toast.success(t('actions.restoreSucceed'), {
        description: notes.length ? notes.join(' ') : undefined,
      });
    },
  });

  const { mutate: mutateResetTrash, isPending: isResetting } = useMutation({
    mutationFn: () => resetTrashItems({ resourceType: TrashType.Base, resourceId: baseId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getTrashItems(baseId) });
      toast.success(t('actions.resetSucceed'));
    },
  });

  const allRows = useMemo(() => {
    const rows: ITrashRow[] = [];
    const push = (items: ITrashItemVo[], depth: number) => {
      for (const item of items) {
        rows.push({ ...item, depth });
        if (item.resourceType === TrashType.Folder && expandedFolders.has(item.resourceId)) {
          push(folderItems[item.resourceId] ?? [], depth + 1);
        }
      }
    };
    push(data ? (data.pages.flat() as ITrashItemVo[]) : [], 0);
    return rows;
  }, [data, expandedFolders, folderItems]);

  const canReset =
    permission?.['table|delete'] &&
    permission?.['app|delete'] &&
    permission?.['automation|delete'] &&
    permission?.['routine|delete'];

  const canRestore = useCallback(
    (resourceType: string) => {
      switch (resourceType) {
        case TrashType.Table:
          return permission?.['table|create'];
        case TrashType.App:
          return permission?.['app|create'];
        case TrashType.Workflow:
          return permission?.['automation|create'];
        case TrashType.Routine:
          return permission?.['routine|create'];
        case TrashType.Dashboard:
        case TrashType.Folder:
          return permission?.['base|update'];
        default:
          return false;
      }
    },
    [permission]
  );

  const columns: ColumnDef<ITrashRow>[] = useMemo(() => {
    const tableColumns: ColumnDef<ITrashRow>[] = [
      {
        accessorKey: 'resourceId',
        header: t('name'),
        size: Number.MAX_SAFE_INTEGER,
        minSize: 156,
        cell: ({ row }) => {
          const resourceId = row.getValue<string>('resourceId');
          const resourceInfo = resourceMap[resourceId];

          if (!resourceInfo) return null;

          const { name } = resourceInfo;
          const { depth, resourceType } = row.original;
          const isFolder = resourceType === TrashType.Folder;
          const expanded = expandedFolders.has(resourceId);
          const Chevron = expanded ? ChevronDown : ChevronRight;

          return (
            <div
              className="flex min-w-0 items-center gap-1"
              style={{ paddingInlineStart: depth * 20 }}
            >
              {isFolder ? (
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 hover:bg-accent"
                  aria-expanded={expanded}
                  onClick={() => toggleFolder(resourceId)}
                >
                  <Chevron className="size-4" />
                </button>
              ) : (
                <span className="size-5 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="truncate text-wrap text-sm [overflow-wrap:anywhere]" title={name}>
                  {name}
                </div>
                {expanded && folderItems[resourceId]?.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    {t('common:trash.emptyFolder')}
                  </div>
                )}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'resourceType',
        header: t('trash.type'),
        size: 96,
        cell: ({ row }) => {
          const resourceType = row.getValue<string>('resourceType');
          const resourceName = () => {
            switch (resourceType) {
              case TrashType.Table:
                return t('common:noun.table');
              case TrashType.App:
                return t('common:noun.app');
              case TrashType.Workflow:
                return t('common:noun.automation');
              case TrashType.Routine:
                return t('common:noun.routine');
              case TrashType.Dashboard:
                return t('common:noun.dashboard');
              case TrashType.Folder:
                return t('common:noun.folder');
              default:
                return '';
            }
          };

          return <div className="text-wrap pe-2 text-sm">{resourceName()}</div>;
        },
      },
      {
        accessorKey: 'deletedBy',
        header: t('trash.deletedBy'),
        size: 196,
        cell: ({ row }) => {
          const createdBy = row.getValue<string>('deletedBy');
          const user = userMap[createdBy];

          if (!user) return null;

          const { name, avatar, email } = user;

          return (
            <Collaborator
              item={{ name, email, avatar, type: PrincipalType.User }}
              className="flex-1"
            />
          );
        },
      },
      {
        accessorKey: 'deletedTime',
        header: t('trash.deletedTime'),
        size: 156,
        cell: ({ row }) => {
          const deletedTime = row.getValue<string>('deletedTime');
          const deletedDateStr = dayjs(deletedTime).format('YYYY/MM/DD HH:mm');
          return <div title={deletedDateStr}>{deletedDateStr}</div>;
        },
      },
      {
        id: 'actions',
        header: t('actions.title'),
        size: 108,
        cell: ({ row }) => {
          const { id: trashId, resourceId, resourceType } = row.original;
          const resourceInfo = resourceMap[resourceId];

          if (!resourceInfo) return null;

          const showRestore = canRestore(resourceType);

          if (!showRestore) return null;

          return (
            <Button
              size="xs"
              variant="outline"
              title={t('actions.restore')}
              onClick={() => mutateRestore({ trashId, resourceType, resourceId })}
            >
              {t('actions.restore')}
            </Button>
          );
        },
      },
    ];

    return tableColumns;
  }, [
    t,
    resourceMap,
    userMap,
    mutateRestore,
    canRestore,
    expandedFolders,
    folderItems,
    toggleFolder,
  ]);

  const fetchNextPageInner = useCallback(() => {
    if (!isFetching && nextCursor) {
      fetchNextPage();
    }
  }, [fetchNextPage, isFetching, nextCursor]);

  const handleResetTrash = useCallback(() => {
    setConfirmVisible(true);
  }, []);

  const handleConfirmReset = useCallback(() => {
    setConfirmVisible(false);
    mutateResetTrash();
  }, [mutateResetTrash]);

  if (!isHydrated || isLoading) return null;

  return (
    <>
      <div className="flex h-screen w-full flex-1 flex-col space-y-4 overflow-hidden pt-8">
        <Head>
          <title>{`${t('noun.trash')} - ${brandName}`}</title>
        </Head>
        <div className="flex w-full items-center justify-between px-8 pb-2">
          <div className="flex flex-col items-start gap-2">
            <h1 className="text-2xl font-semibold">{t('noun.trash')}</h1>
            {!isCommunity && retentionDays > 0 && (
              <p className="shrink-0 grow-0 text-start text-sm text-zinc-500">
                {t('common:trash.baseDescription', { retentionDays })}
              </p>
            )}
          </div>
          {canReset && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleResetTrash}
              disabled={allRows.length === 0 || isResetting}
            >
              {t('trash.resetTrash')}
            </Button>
          )}
        </div>
        <InfiniteTable
          rows={allRows}
          columns={columns}
          className="px-8"
          fetchNextPage={fetchNextPageInner}
        />
      </div>
      <ConfirmDialog
        open={isConfirmVisible}
        onOpenChange={setConfirmVisible}
        title={t('trash.resetTrashConfirm')}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={handleConfirmReset}
      />
    </>
  );
};
