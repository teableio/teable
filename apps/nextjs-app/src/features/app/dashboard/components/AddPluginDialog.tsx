import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  IDashboardInstallPluginRo,
  IGetPluginCenterListVo,
  IPluginI18n,
} from '@teable/openapi';
import { getPluginCenterList, installPlugin, PluginPosition } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { get } from 'lodash';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { PluginDetail } from './PluginDetail';

export const AddPluginDialog = (props: { children?: React.ReactNode; dashboardId: string }) => {
  const { children, dashboardId } = props;
  const baseId = useBaseId()!;
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const language = i18n.language as unknown as keyof IPluginI18n;
  const [detailPlugin, setDetailPlugin] = useState<IGetPluginCenterListVo[number]>();

  const { data: plugins } = useQuery({
    queryKey: ['plugin-center', PluginPosition.Dashboard] as const,
    queryFn: ({ queryKey }) => getPluginCenterList([queryKey[1]]).then((res) => res.data),
  });

  const { mutate: installPluginMutate } = useMutation({
    mutationFn: (ro: IDashboardInstallPluginRo) => installPlugin(baseId, dashboardId, ro),
    onSuccess: () => {
      setDetailPlugin(undefined);
      setOpen(false);
      queryClient.invalidateQueries(ReactQueryKeys.getDashboard(dashboardId));
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="max-w-4xl"
        style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 100px)' }}
      >
        <div className="mt-4 w-full space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
          {plugins?.map((plugin) => {
            const name = get(plugin.i18n, [language, 'name']) ?? plugin.name;
            const description = get(plugin.i18n, [language, 'description']) ?? plugin.description;
            const detailDesc = get(plugin.i18n, [language, 'detailDesc']) ?? plugin.detailDesc;
            return (
              <button
                key={plugin.id}
                className="flex h-20 cursor-pointer items-center gap-3 rounded border p-2 hover:bg-accent"
                onClick={() =>
                  setDetailPlugin({
                    ...plugin,
                    name,
                    description,
                    detailDesc,
                  })
                }
              >
                <Image
                  src={plugin.logo}
                  alt={name}
                  width={56}
                  height={56}
                  sizes="100%"
                  style={{
                    objectFit: 'contain',
                  }}
                />
                <div className="flex-auto text-left">
                  <div>{name}</div>
                  <div
                    className="line-clamp-2 break-words text-[13px] text-muted-foreground"
                    title={description}
                  >
                    {description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {detailPlugin && (
          <PluginDetail
            plugin={detailPlugin}
            onBack={() => setDetailPlugin(undefined)}
            onInstall={() => {
              installPluginMutate({ pluginId: detailPlugin.id, name: detailPlugin.name });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
