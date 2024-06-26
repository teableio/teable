import { useTranslation } from 'next-i18next';
import { CopyButton } from '@/features/app/components/CopyButton';

interface ICopyInstanceProps {
  instanceId: string;
}

export const CopyInstance = (props: ICopyInstanceProps) => {
  const { instanceId } = props;
  const { t } = useTranslation('common');

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-x-2 overflow-hidden rounded-md bg-slate-100 p-4 dark:bg-slate-700">
      <span className="text-sm font-semibold">{t('noun.instanceId')}</span>
      <span className="flex-1 truncate text-sm text-gray-600">{instanceId}</span>
      <CopyButton size="xs" text={instanceId} />
    </div>
  );
};
