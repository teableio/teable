/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

export const IntegrationHeader = (props: {
  detailName?: string;
  onBack?: () => void;
  className?: string;
}) => {
  const { detailName, onBack, className } = props;
  const { t } = useTranslation('common');
  return (
    <div className={cn('flex items-center text-lg font-medium', className)}>
      <h3
        className={cn('text-lg font-medium', {
          'hover:underline hover:text-foreground cursor-pointer text-muted-foreground': detailName,
        })}
        onClick={onBack}
      >
        {t('settings.integration.title')}
      </h3>
      {detailName && <div className="px-2">/</div>}
      {detailName && <div>{detailName}</div>}
    </div>
  );
};
