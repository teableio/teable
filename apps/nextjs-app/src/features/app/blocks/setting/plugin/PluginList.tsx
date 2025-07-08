import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings, Trash2 } from '@teable/icons';
import { deletePlugin, getPlugins } from '@teable/openapi';
import type { PluginStatus } from '@teable/openapi';
import { Button, Card, CardContent } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';
import { StatusBadge } from './component/StatusBadge';
import { StatusDot } from './component/StatusDot';
import { useStatusStatic } from './hooks/useStatusStatic';

export const PluginList = () => {
  const router = useRouter();
  const { t } = useTranslation(settingPluginConfig.i18nNamespaces);
  const queryClient = useQueryClient();
  const statusStatic = useStatusStatic();

  const { data: pluginList } = useQuery({
    queryKey: ['plugin-list'],
    queryFn: () => getPlugins().then((res) => res.data),
  });

  const { mutate: deletePluginMutate } = useMutation({
    mutationFn: deletePlugin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugin-list'] });
    },
  });

  return (
    <div>
      <div className="flex justify-between">
        <div className="flex gap-1">
          {Object.keys(statusStatic).map((status) => (
            <StatusBadge key={status} status={status as PluginStatus} />
          ))}
        </div>
        <Button
          size={'xs'}
          onClick={() => {
            router.push({ pathname: router.pathname, query: { form: 'new' } });
          }}
        >
          <Plus />
          {t('plugin:add')}
        </Button>
      </div>
      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-3">
        {pluginList?.map((plugin) => (
          <Card key={plugin.id} className="group shadow-none hover:shadow-md">
            <CardContent className="relative flex size-full items-center gap-5 px-2 py-3">
              <div className="relative size-16 overflow-hidden rounded-sm">
                <Image
                  src={plugin.logo}
                  alt={plugin.name}
                  fill
                  sizes="100%"
                  style={{
                    objectFit: 'contain',
                  }}
                />
              </div>
              <div className="h-full flex-1 overflow-hidden">
                <div className="flex h-6 items-center gap-1 pr-11">
                  <StatusDot className="shrink-0" status={plugin.status} />
                  <div className="line-clamp-1 break-words text-sm">{plugin.name}</div>
                </div>
                <div
                  className="line-clamp-3 break-words text-xs text-muted-foreground"
                  title={plugin.description}
                >
                  {plugin.description}
                </div>
              </div>
              <div className="absolute right-2 top-3 space-x-1.5">
                <Button
                  className="h-5 p-0.5"
                  variant={'ghost'}
                  onClick={() => {
                    router.push({
                      pathname: router.pathname,
                      query: { form: 'edit', id: plugin.id },
                    });
                  }}
                >
                  <Settings />
                </Button>
                <Button
                  className="h-5 p-0.5"
                  variant={'ghost'}
                  onClick={() => {
                    deletePluginMutate(plugin.id);
                  }}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
