import { useTranslation } from 'next-i18next';
import { CopyButton } from '@/features/app/components/CopyButton';
import { useEnv } from '@/features/app/hooks/useEnv';

interface ICopyInstanceProps {
  instanceId: string;
}

export const CopyInstance = (props: ICopyInstanceProps) => {
  const { instanceId } = props;
  const { t } = useTranslation('common');
  const { buildVersion, gitCommitSha, previewTag } = useEnv();
  const shortGitCommitSha = gitCommitSha?.slice(0, 12);
  const displayBuildVersion = buildVersion ?? process.env.APP_VERSION ?? 'develop';

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-x-2 overflow-hidden rounded-md bg-secondary p-4">
      <div className="flex flex-col gap-y-1">
        <span>
          <span className="text-sm font-semibold">{t('noun.instanceId')} </span>
          <span className="flex-1 truncate text-sm text-muted-foreground">{instanceId}</span>
        </span>
        <div className="text-left text-xs text-muted-foreground">
          <p>
            {t('settings.setting.version')}: {displayBuildVersion}
          </p>
          {previewTag && (
            <p className="mt-1">
              {`preview: ${previewTag}`}
              {shortGitCommitSha ? ` · commit: ${shortGitCommitSha}` : ''}
            </p>
          )}
        </div>
      </div>
      <CopyButton
        size="xs"
        text={instanceId}
        className="bg-surface hover:bg-surface hover:opacity-80"
        iconClassName="text-foreground"
        label={t('admin.configuration.copyInstance')}
      />
    </div>
  );
};
