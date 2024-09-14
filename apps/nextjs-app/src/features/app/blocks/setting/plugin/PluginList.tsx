import { useQuery } from '@tanstack/react-query';
import { Plus, Settings } from '@teable/icons';
import { getPlugins } from '@teable/openapi';
import { Button, Card, CardContent } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';

export const PluginList = () => {
  const router = useRouter();
  const { t } = useTranslation(settingPluginConfig.i18nNamespaces);
  const { data: pluginList } = useQuery({
    queryKey: ['plugin-list'],
    queryFn: () => getPlugins().then((res) => res.data),
  });

  const previewUrl = usePreviewUrl();
  return (
    <div>
      <div className="flex justify-end">
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
                  src={previewUrl(plugin.logo)}
                  alt={plugin.name}
                  fill
                  sizes="100%"
                  style={{
                    objectFit: 'contain',
                  }}
                />
              </div>
              <div className="h-full flex-1 overflow-hidden">
                <div className="line-clamp-2 break-words text-sm">{plugin.name}</div>
                <div
                  className="line-clamp-3 break-words text-xs text-muted-foreground"
                  title={plugin.description}
                >
                  {plugin.description}
                </div>
              </div>
              <Button
                className="absolute right-2 top-2 h-5 p-0.5"
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
