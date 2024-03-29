import { cn } from '@teable/ui-lib';
import { useTranslation } from '../../context/app/i18n';

interface IRecordItemProps {
  title?: string;
  active?: boolean;
}

export const RecordItem = (props: IRecordItemProps) => {
  const { active, title } = props;
  const { t } = useTranslation();

  return (
    <div
      tabIndex={-1}
      role={'button'}
      className={cn(
        'group relative w-full cursor-pointer truncate rounded-md border border-input px-4 py-2 shadow-sm',
        {
          'border-l-8 border-l-foreground': active,
        }
      )}
    >
      <div
        className="w-full truncate font-mono text-sm"
        title={title?.replaceAll('\n', ' ') || t('common.unnamedRecord')}
      >
        {title?.replaceAll('\n', ' ') || t('common.unnamedRecord')}
      </div>
    </div>
  );
};
