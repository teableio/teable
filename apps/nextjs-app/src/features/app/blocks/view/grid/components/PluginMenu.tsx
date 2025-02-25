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
  Separator,
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

  return (
    <Fragment>
      <CommandGroup aria-valuetext="name">
        <HoverCard openDelay={100}>
          <HoverCardTrigger>
            <CommandItem className="h-9 justify-between px-4">
              <div className="flex items-center justify-between gap-2">
                <Puzzle className="size-4 shrink-0" />
                {t('common:noun.plugin')}
              </div>
              <ChevronRight className="size-4" />
            </CommandItem>
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
                'h-32': pluginContextMenu?.length && pluginContextMenu.length > 5,
              })}
            >
              <div className="flex flex-col">
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
            <Separator />
            <div className="m-1 h-9">
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 px-4 text-sm font-normal"
                onClick={async () => {
                  pluginContextMenuManageDialogRef.current?.open();
                }}
              >
                <Settings className="mr-2 size-4 shrink-0" />
                {t('table:pluginContextMenu.mangeButton')}
              </Button>
            </div>
          </HoverCardContent>
        </HoverCard>
      </CommandGroup>
      <CommandSeparator />
      {tableId && (
        <PluginContextMenuManageDialog tableId={tableId} ref={pluginContextMenuManageDialogRef} />
      )}
    </Fragment>
  );
};
