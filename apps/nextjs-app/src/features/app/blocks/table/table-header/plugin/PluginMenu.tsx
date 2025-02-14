import { useQuery } from '@tanstack/react-query';
import type { IGetPluginCenterListVo } from '@teable/openapi';
import { getPluginCenterList, PluginPosition } from '@teable/openapi';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import type { IPluginCenterDialogRef } from '@/features/app/components/plugin/PluginCenterDialog';
import { PluginCenterDialog } from '@/features/app/components/plugin/PluginCenterDialog';
import { FloatPlugin } from './FloatPlugin';
import { useFloatPlugin } from './useFloatPlugin';

export const PluginMenu = (props: { children: React.ReactNode }) => {
  const { children } = props;
  const ref = useRef<IPluginCenterDialogRef>(null);
  const { t } = useTranslation('table');
  const { touchRecentPlugin, sortedRecentPlugins } = useFloatPlugin();
  const [floatPlugin, setFloatPlugin] = useState<IGetPluginCenterListVo[number]>();
  const hasRecentPlugins = Boolean(sortedRecentPlugins?.length);
  const sortedRecentPluginIds = sortedRecentPlugins?.map((plugin) => plugin.id)?.slice(0, 5);
  const { data: recentPlugins } = useQuery({
    queryKey: ['plugin-center', PluginPosition.Float, sortedRecentPluginIds],
    queryFn: () =>
      getPluginCenterList([PluginPosition.Float], sortedRecentPluginIds).then((res) => res.data),
    enabled: Boolean(sortedRecentPluginIds?.length),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent className="max-w-64">
          {hasRecentPlugins && (
            <>
              <DropdownMenuLabel>{t('plugin.recent')}</DropdownMenuLabel>
              <DropdownMenuGroup>
                {recentPlugins?.map((plugin) => (
                  <DropdownMenuItem
                    className="gap-2"
                    key={plugin.id}
                    onClick={() => {
                      setFloatPlugin(plugin);
                    }}
                  >
                    <Image
                      src={plugin.logo}
                      alt={plugin.name}
                      width={20}
                      height={20}
                      sizes="100%"
                      style={{
                        objectFit: 'contain',
                      }}
                    />
                    <div className="truncate">{plugin.name}</div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            onClick={() => {
              ref.current?.open();
            }}
          >
            {t('plugin.more')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PluginCenterDialog
        ref={ref}
        positionType={PluginPosition.Float}
        onInstall={(id, _name, detail) => {
          touchRecentPlugin(id);
          setFloatPlugin(detail);
          ref.current?.close();
        }}
      />
      {floatPlugin && (
        <FloatPlugin
          pluginId={floatPlugin.id}
          name={floatPlugin.name}
          pluginUrl={floatPlugin.url}
          onClose={() => {
            setFloatPlugin(undefined);
          }}
        />
      )}
    </>
  );
};
