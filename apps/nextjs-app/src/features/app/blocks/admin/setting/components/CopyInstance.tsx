import { useTranslation } from 'next-i18next';
import { CopyButton } from '@/features/app/components/CopyButton';

interface ICopyInstanceProps {
  instanceId: string;
}

export const CopyInstance = (props: ICopyInstanceProps) => {
  const { instanceId } = props;
  const { t } = useTranslation('common');

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-x-2 overflow-hidden rounded-md bg-secondary p-4">
      <div className="flex flex-col gap-y-1">
        <span>
          <span className="text-sm font-semibold">{t('noun.instanceId')} </span>
          <span className="flex-1 truncate text-sm text-muted-foreground">{instanceId}</span>
        </span>
        <p className="text-left text-xs text-muted-foreground">
          {t('settings.setting.version')}: {process.env.NEXT_PUBLIC_BUILD_VERSION}
        </p>
      </div>
      <CopyButton
        size="xs"
        text={instanceId}
        className="bg-card hover:bg-card hover:opacity-80"
        iconClassName="text-foreground"
        label={t('admin.configuration.copyInstance')}
      />
    </div>
  );
};
