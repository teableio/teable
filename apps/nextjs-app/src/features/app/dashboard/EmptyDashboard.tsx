import { useBasePermission } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { CreateDashboardDialog } from './components/CreateDashboardDialog';

export const EmptyDashboard = () => {
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  const basePermissions = useBasePermission();
  const canManage = basePermissions?.['base|update'];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-20">
      <h1 className="text-2xl font-semibold">{t('dashboard:empty.title')}</h1>
      <p className="text-center text-muted-foreground">{t('dashboard:empty.description')}</p>
      {canManage && (
        <CreateDashboardDialog>
          <Button size={'xs'}>{t('dashboard:empty.create')}</Button>
        </CreateDashboardDialog>
      )}
    </div>
  );
};
