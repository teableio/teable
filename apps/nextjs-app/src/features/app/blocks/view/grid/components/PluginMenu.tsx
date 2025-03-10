import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Puzzle, Settings } from '@teable/icons';
import { getPluginContextMenuList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Button,
  cn,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  ScrollArea,
} from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { Fragment, useRef } from 'react';
import {
  PluginContextMenuManageDialog,
  type IPluginContextMenuManageDialogRef,
} from '@/features/app/components/plugin-context-menu/PluginContextMenuManageDialog';
import { useActiveMenuPluginStore } from '@/features/app/components/plugin-context-menu/useActiveMenuPlugin';
import { tableConfig } from '@/features/i18n/table.config';

export const PluginMenu = (props: { tableId?: string; closeRecordMenu: () => void }) => {
  const { tableId, closeRecordMenu } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { setActivePluginId } = useActiveMenuPluginStore();
  const { data: pluginContextMenu } = useQuery({
    queryKey: ReactQueryKeys.getPluginContextMenuPlugins(tableId!),
    queryFn: ({ queryKey }) => getPluginContextMenuList(queryKey[1]).then((res) => res.data),
    enabled: !!tableId,
  });
  const pluginContextMenuManageDialogRef = useRef<IPluginContextMenuManageDialogRef>(null);
  const menuItems = pluginContextMenu?.slice(0, 3);
  const hasMore = pluginContextMenu && pluginContextMenu.length > 3;

  return (
    <Fragment>
      <CommandGroup
        aria-valuetext="name"
        heading={
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Puzzle className="shrink-0" />
              {t('common:noun.plugin')}
            </div>
            <HoverCard openDelay={100}>
              <HoverCardTrigger>
                <Button
                  variant="link"
                  size={'xs'}
                  className={cn('h-auto font-normal text-muted-foreground gap-0 p-0', {
                    hidden: !hasMore,
                  })}
                >
                  {t('common:actions.more')}
                  <ChevronRight />
                </Button>
              </HoverCardTrigger>
              <HoverCardContent
                side="right"
                align="start"
                sideOffset={10}
                className="p-0"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <ScrollArea
                  className={cn({
                    'h-40': pluginContextMenu?.length && pluginContextMenu.length > 5,
                  })}
                >
                  <div className="flex flex-col py-1">
                    {!pluginContextMenu?.length && (
                      <div className="flex items-center justify-center py-2 text-[13px] text-muted-foreground">
                        {t('table:pluginContextMenu.noPlugin')}
                      </div>
                    )}
                    {pluginContextMenu?.map(({ pluginInstallId, name, logo }) => {
                      return (
                        <Button
                          variant="ghost"
                          className="mx-1 h-9 justify-start gap-2 px-4 text-sm font-normal"
                          key={pluginInstallId}
                          onClick={async () => {
                            closeRecordMenu();
                            setActivePluginId(pluginInstallId);
                          }}
                        >
                          <Image
                            className="size-4 shrink-0 rounded-sm"
                            src={logo}
                            alt={name}
                            width={56}
                            height={56}
                            sizes="100%"
                            style={{
                              objectFit: 'contain',
                            }}
                          />
                          {name}
                        </Button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </HoverCardContent>
            </HoverCard>
          </div>
        }
      >
        {menuItems?.map(({ pluginInstallId, name, logo }) => (
          <CommandItem
            className="h-9 justify-start gap-2 px-4 text-sm font-normal"
            key={pluginInstallId}
            value={pluginInstallId}
            onSelect={async () => {
              closeRecordMenu();
              setActivePluginId(pluginInstallId);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Image
              className="size-4 shrink-0 rounded-sm"
              src={logo}
              alt={name}
              width={56}
              height={56}
              sizes="100%"
              style={{
                objectFit: 'contain',
              }}
            />
            {name}
          </CommandItem>
        ))}
        <CommandItem
          className="h-9 justify-start gap-2 px-4 text-sm font-normal"
          onSelect={async () => {
            pluginContextMenuManageDialogRef.current?.open();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Settings className="size-4 shrink-0" />
          {t('table:pluginContextMenu.mangeButton')}
        </CommandItem>
      </CommandGroup>

      <CommandSeparator />
      {tableId && (
        <PluginContextMenuManageDialog tableId={tableId} ref={pluginContextMenuManageDialogRef} />
      )}
    </Fragment>
  );
};
