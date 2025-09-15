import { Plus } from '@teable/icons';
import { useTheme } from '@teable/next-themes';
import { useBasePermission } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { CreateDashboardDialog } from './components/CreateDashboardDialog';

export const EmptyDashboard = () => {
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);

  const basePermissions = useBasePermission();
  const canManage = basePermissions?.['base|update'];
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-20">
      <Image
        src={
          isDark
            ? '/images/layout/empty-dashboard-dark.png'
            : '/images/layout/empty-dashboard-light.png'
        }
        alt="Empty dashboard"
        width={240}
        height={240}
        className="mb-6"
      />
      <div className="text-center">
        <h3 className="mb-3 text-xl font-semibold text-foreground">{t('dashboard:empty.title')}</h3>
        <p className="mb-6 max-w-md text-sm text-muted-foreground">
          {t('dashboard:empty.description')}
        </p>
        {canManage && (
          <CreateDashboardDialog>
            <Button size="lg" className="px-8">
              <Plus /> {t('dashboard:empty.create')}
            </Button>
          </CreateDashboardDialog>
        )}
      </div>
    </div>
  );
};
