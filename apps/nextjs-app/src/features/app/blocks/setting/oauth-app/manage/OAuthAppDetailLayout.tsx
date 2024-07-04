import { Spin } from '@teable/ui-lib/base';
import { Button, Separator } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';

interface IOAuthAppDetailLayoutProps {
  children: React.ReactNode | React.ReactNode[] | null;
  loading?: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
}

export const OAuthAppDetailLayout = (props: IOAuthAppDetailLayoutProps) => {
  const { children, onCancel, onSubmit, loading } = props;

  const { t } = useTranslation(oauthAppConfig.i18nNamespaces);

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-0.5">
      {children}
      <Separator />
      <div className="space-x-3 text-right">
        <Button size={'sm'} variant={'ghost'} onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
        <Button size={'sm'} onClick={onSubmit} disabled={loading}>
          {loading && <Spin />}
          {t('common:actions.submit')}
        </Button>
      </div>
    </div>
  );
};
