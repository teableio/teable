import { Frown } from '@teable/icons';
import { Alert, AlertDescription, AlertTitle } from '@teable/ui-lib/shadcn/ui/alert';
import { useTranslation } from 'next-i18next';

export const FailAlert: React.FC = () => {
  const { t } = useTranslation(['table']);
  return (
    <div className="flex size-full items-center justify-center">
      <Alert className="w-[400px]">
        <Frown className="size-5" />
        <AlertTitle>{t('view.crash.title')}</AlertTitle>
        <AlertDescription>{t('view.crash.description')}</AlertDescription>
      </Alert>
    </div>
  );
};
