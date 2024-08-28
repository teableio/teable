import { ArrowLeft } from '@teable/icons';
import type { IGetPluginCenterListVo } from '@teable/openapi';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { MarkdownPreview } from '../../components/MarkdownPreview';
import { UserAvatar } from '../../components/user/UserAvatar';
import { usePreviewUrl } from '../../hooks/usePreviewUrl';

export const PluginDetail = (props: {
  plugin: IGetPluginCenterListVo[number];
  onInstall?: () => void;
  onBack?: () => void;
}) => {
  const { plugin, onBack, onInstall } = props;
  const previewUrl = usePreviewUrl();
  const dayjs = useLanDayjs();
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  return (
    <div className="absolute left-0 top-0 flex size-full flex-col bg-background">
      <Button className="ml-2 mt-2 w-20" variant={'ghost'} size={'sm'} onClick={onBack}>
        <ArrowLeft />
        {t('common.back')}
      </Button>
      <div className="flex-1 gap-3 overflow-auto px-4 md:flex">
        <div className="flex-1">
          <div className="mb-4 flex h-20 items-center gap-3 p-2">
            <Image
              src={previewUrl(plugin.logo)}
              alt={plugin.name}
              width={56}
              height={56}
              sizes="100%"
              style={{
                objectFit: 'contain',
              }}
            />
            <div className="flex-auto">
              <div>{plugin.name}</div>
              <div
                className="line-clamp-2 break-words text-[13px] text-muted-foreground"
                title={plugin.description}
              >
                {plugin.description}
              </div>
            </div>
          </div>
          <Button className="w-full md:hidden" size={'sm'} onClick={onInstall}>
            {t('dashboard:install')}
          </Button>
          <div>
            <MarkdownPreview>{plugin.detailDesc}</MarkdownPreview>
          </div>
        </div>
        <div className="mb-4 w-1/4 space-y-4 text-sm">
          <Button className="hidden w-full md:inline-block" size={'sm'} onClick={onInstall}>
            {t('dashboard:install')}
          </Button>
          <div className="space-y-2">
            <p>{t('dashboard:publisher')}</p>
            <div className="flex items-center gap-2">
              <UserAvatar
                user={{
                  name: plugin.createdBy.name,
                  avatar: plugin.createdBy.avatar,
                }}
              />
              {plugin.createdBy.name}
            </div>
          </div>
          <div className="space-y-1">
            <p>{t('dashboard:lastUpdated')}</p>
            <p className="text-xs">{dayjs(plugin.lastModifiedTime).fromNow()}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
