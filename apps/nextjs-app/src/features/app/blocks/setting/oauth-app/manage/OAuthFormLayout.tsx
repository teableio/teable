import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { SettingStack } from '@/features/app/components/setting/SettingSection';

interface IOAuthFormLayoutProps {
  children: ReactNode;
  loading?: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
}

/** The OAuth app form's sections, then Cancel and Submit at the end. */
export const OAuthFormLayout = ({
  children,
  loading,
  onSubmit,
  onCancel,
}: IOAuthFormLayoutProps) => {
  const { t } = useTranslation('common');

  return (
    <SettingStack>
      {children}
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
        <Button size="sm" onClick={onSubmit} disabled={loading}>
          {loading && <Spin />}
          {t('actions.submit')}
        </Button>
      </div>
    </SettingStack>
  );
};
