import { TeableNew } from '@teable/icons';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { authConfig } from '@/features/i18n/auth.config';

interface ITeableHeaderProps {
  className?: string;
  enableClick?: boolean;
}

export const TeableFooter = (props: ITeableHeaderProps) => {
  const { className, enableClick } = props;
  const { t } = useTranslation(authConfig.i18nNamespaces);

  return (
    <div
      data-state={enableClick ? 'click' : undefined}
      className={cn(
        'max-w-6xl mx-auto w-full flex items-center justify-center gap-2 data-[state=click]:cursor-pointer font-bold',
        className
      )}
    >
      <TeableNew className="size-8 text-black" />
      {t('common:brand')}
    </div>
  );
};
