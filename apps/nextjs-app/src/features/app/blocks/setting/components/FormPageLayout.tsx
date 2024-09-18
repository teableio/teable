import { Spin } from '@teable/ui-lib/base';
import { Button, Separator } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

interface IFormPageLayoutProps {
  children: React.ReactNode | React.ReactNode[] | null;
  loading?: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
}

export const FormPageLayout = (props: IFormPageLayoutProps) => {
  const { children, onCancel, onSubmit, loading } = props;

  const { t } = useTranslation('common');

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-0.5">
      {children}
      <Separator />
      <div className="space-x-3 text-right">
        <Button size={'sm'} variant={'ghost'} onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
        <Button size={'sm'} onClick={onSubmit} disabled={loading}>
          {loading && <Spin />}
          {t('actions.submit')}
        </Button>
      </div>
    </div>
  );
};
