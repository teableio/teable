import { ArrowLeft } from '@teable/icons';
import type { IGetPluginCenterListVo } from '@teable/openapi';
import { MarkdownPreview } from '@teable/sdk';
import { useLanDayjs } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { UserAvatar } from '../user/UserAvatar';

export const PluginDetail = (props: {
  plugin: IGetPluginCenterListVo[number];
  onInstall?: () => void;
  onBack?: () => void;
}) => {
  const { plugin, onBack, onInstall } = props;
  const dayjs = useLanDayjs();
  const { t } = useTranslation(['common']);
  return (
    <div className="absolute left-0 top-0 flex size-full flex-col rounded bg-background">
      <Button className="ml-2 mt-2 w-20" variant={'ghost'} size={'sm'} onClick={onBack}>
        <ArrowLeft />
        {t('common:actions.back')}
      </Button>
      <div className="flex-1 gap-3 overflow-auto px-4 md:flex">
        <div className="flex-1">
          <div className="mb-4 flex h-20 items-center gap-3 p-2">
            <Image
              src={plugin.logo}
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
            {t('common:pluginCenter.install')}
          </Button>
          <div>
            <MarkdownPreview>{plugin.detailDesc}</MarkdownPreview>
          </div>
        </div>
        <div className="mb-4 w-1/4 space-y-4 text-sm">
          <Button className="hidden w-full md:inline-block" size={'sm'} onClick={onInstall}>
            {t('common:pluginCenter.install')}
          </Button>
          <div className="space-y-2">
            <p>{t('common:pluginCenter.publisher')}</p>
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
            <p>{t('common:pluginCenter.lastUpdated')}</p>
            <p className="text-xs">{dayjs(plugin.lastModifiedTime).fromNow()}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
