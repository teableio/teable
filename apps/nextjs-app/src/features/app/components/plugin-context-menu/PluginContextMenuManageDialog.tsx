import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DraggableHandle, Pencil, Plus, Trash2, X } from '@teable/icons';
import type {
  IPluginContextMenuGetItem,
  IPluginContextMenuInstallRo,
  IPluginContextMenuMoveRo,
  IPluginContextMenuRenameRo,
} from '@teable/openapi';
import {
  getPluginContextMenuList,
  installPluginContextMenu,
  movePluginContextMenu,
  PluginPosition,
  removePluginContextMenu,
  renamePluginContextMenu,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { DragEndEvent } from '@teable/ui-lib/base';
import { ConfirmDialog, DndKitContext, Draggable, Droppable } from '@teable/ui-lib/base';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  Input,
} from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { PluginCenterDialog } from '../plugin/PluginCenterDialog';

interface IPluginContextMenuManageDialogProps {
  tableId: string;
}

export interface IPluginContextMenuManageDialogRef {
  open: () => void;
  close: () => void;
}

export const PluginContextMenuManageDialog = forwardRef<
  IPluginContextMenuManageDialogRef,
  IPluginContextMenuManageDialogProps
>(({ tableId }, ref) => {
  ref;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [renamePluginInstallId, setRenamePluginInstallId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [deletePluginInstallId, setDeletePluginInstallId] = useState<string | null>(null);

  const { data: pluginContextMenu } = useQuery({
    queryKey: ReactQueryKeys.getPluginContextMenuPlugins(tableId),
    queryFn: ({ queryKey }) => getPluginContextMenuList(queryKey[1]).then((res) => res.data),
  });

  const [pluginContextMenuList, setPluginContextMenuList] = useState<IPluginContextMenuGetItem[]>(
    []
  );

  useEffect(() => {
    if (!pluginContextMenu) {
      return;
    }
    setPluginContextMenuList(pluginContextMenu);
  }, [pluginContextMenu]);

  const { mutate: deletePluginContextMenu, isLoading: isDeleting } = useMutation({
    mutationFn: ({ pluginInstallId }: { pluginInstallId: string }) =>
      removePluginContextMenu(tableId, pluginInstallId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.getPluginContextMenuPlugins(tableId),
      });
      setDeletePluginInstallId(null);
    },
  });

  const { mutate: installPlugin } = useMutation({
    mutationFn: (ro: IPluginContextMenuInstallRo) => installPluginContextMenu(tableId, ro),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.getPluginContextMenuPlugins(tableId),
      });
    },
  });

  const { mutate: updateOrder } = useMutation({
    mutationFn: (ro: IPluginContextMenuMoveRo & { pluginInstallId: string }) =>
      movePluginContextMenu(tableId, ro.pluginInstallId, ro),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.getPluginContextMenuPlugins(tableId),
      });
    },
  });

  const { mutate: renamePlugin } = useMutation({
    mutationFn: (ro: IPluginContextMenuRenameRo & { pluginInstallId: string }) =>
      renamePluginContextMenu(tableId, ro.pluginInstallId, ro),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.getPluginContextMenuPlugins(tableId),
      });
      setRenamePluginInstallId(null);
      setName('');
    },
  });

  const [open, setOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const onDragEndHandler = async (event: DragEndEvent) => {
    const { over, active } = event;
    const to = over?.data?.current?.sortable?.index;
    const from = active?.data?.current?.sortable?.index;
    const list = pluginContextMenu ?? [];

    if (!over || !list.length || from === to) {
      return;
    }

    const plugin = list[from];
    const anchorPlugin = list[to];
    const position = to > from ? 'after' : 'before';
    updateOrder({
      pluginInstallId: plugin.pluginInstallId,
      anchorId: anchorPlugin.pluginInstallId,
      position,
    });
    setPluginContextMenuList((prev) => {
      const pre = [...prev];
      pre.splice(from, 1);
      pre.splice(to, 0, plugin);
      return pre;
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen} modal>
      <DialogContent
        closeable={false}
        overlay={
          <DialogOverlay
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          />
        }
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 truncate text-sm font-medium">
              {t('table:pluginContextMenu.manage')}
            </div>
            <div className="flex gap-2">
              <PluginCenterDialog
                positionType={PluginPosition.ContextMenu}
                onInstall={(id, name) => {
                  installPlugin({ pluginId: id, name });
                }}
              >
                <Button size={'sm'} variant={'outline'}>
                  <Plus />
                  {t('table:addPlugin')}
                </Button>
              </PluginCenterDialog>
              <Button size={'sm'} variant={'outline'} onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {!pluginContextMenuList?.length && (
            <div className="flex items-center justify-center py-2 text-[13px] text-muted-foreground">
              {t('table:pluginContextMenu.noPlugin')}
            </div>
          )}
          <DndKitContext onDragEnd={onDragEndHandler}>
            <Droppable
              items={pluginContextMenuList.map(({ pluginInstallId }) => pluginInstallId)}
              overlayRender={(active) => {
                const activePlugin = pluginContextMenuList.find(
                  (plugin) => plugin.pluginInstallId === active?.id
                );
                if (!activePlugin) {
                  return <div />;
                }
                return (
                  <div
                    key={activePlugin.pluginInstallId}
                    className="flex items-center gap-2 rounded-sm bg-muted p-1"
                  >
                    <Image
                      src={activePlugin.logo}
                      alt={activePlugin.name}
                      width={30}
                      height={30}
                      className="rounded-sm"
                    />
                    <div className="line-clamp-1 flex-1 text-[13px]">{activePlugin.name}</div>
                  </div>
                );
              }}
            >
              {pluginContextMenuList?.map((plugin) => (
                <Draggable key={plugin.pluginInstallId} id={plugin.pluginInstallId}>
                  {({ setNodeRef, attributes, listeners, style }) => (
                    <div ref={setNodeRef} {...attributes} style={style}>
                      <div
                        key={plugin.pluginInstallId}
                        className="group flex h-10 items-center gap-2 rounded-sm px-1 hover:bg-muted"
                        {...listeners}
                      >
                        <Image
                          src={plugin.logo}
                          alt={plugin.name}
                          width={30}
                          height={30}
                          quality={100}
                          className="rounded-sm"
                        />
                        <div className="relative flex h-full flex-1 items-center text-[13px]">
                          <p className="line-clamp-1">{plugin.name}</p>
                          {renamePluginInstallId === plugin.pluginInstallId && (
                            <Input
                              ref={renameInputRef}
                              className="absolute z-20 flex-1 bg-background text-[13px]"
                              value={name}
                              // eslint-disable-next-line jsx-a11y/no-autofocus
                              autoFocus
                              onChange={(e) => setName(e.target.value)}
                              onBlur={() => {
                                renamePlugin({ pluginInstallId: plugin.pluginInstallId, name });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  renamePlugin({ pluginInstallId: plugin.pluginInstallId, name });
                                }
                                e.stopPropagation();
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                            />
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <Button
                            size={'icon'}
                            variant={'link'}
                            className="h-full w-auto p-0 text-gray-500 hover:text-primary"
                            onClick={() => {
                              setRenamePluginInstallId(plugin.pluginInstallId);
                              setName(plugin.name);
                            }}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size={'icon'}
                            variant={'link'}
                            className="h-full w-auto p-0 text-gray-500 hover:text-primary"
                            onClick={() => {
                              setDeletePluginInstallId(plugin.pluginInstallId);
                            }}
                          >
                            <Trash2 />
                          </Button>
                          <DraggableHandle className="size-4 text-gray-500" />
                        </div>
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
            </Droppable>
          </DndKitContext>
        </div>
        <ConfirmDialog
          open={!!deletePluginInstallId}
          title={t('table:pluginContextMenu.delete')}
          description={t('table:pluginContextMenu.deleteDescription')}
          confirmText={t('common:actions.confirm')}
          cancelText={t('common:actions.cancel')}
          confirmLoading={isDeleting}
          onConfirm={() => {
            deletePluginInstallId &&
              deletePluginContextMenu({ pluginInstallId: deletePluginInstallId });
          }}
          onCancel={() => {
            setDeletePluginInstallId(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
});

PluginContextMenuManageDialog.displayName = 'PluginContextMenuManageDialog';
