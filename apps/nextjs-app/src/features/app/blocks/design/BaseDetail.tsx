import { Database } from '@teable/icons';
import { useBase } from '@teable/sdk/hooks';
import { useTranslation } from 'next-i18next';
import { useEnv } from '@/features/app/hooks/useEnv';
import { IntegrityButton } from './components/Integrity';

export const BaseDetail = () => {
  const { t } = useTranslation(['table']);
  const base = useBase();
  const { driver } = useEnv();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Database className="size-4" />
        <h2 className="font-semibold">{t('table:table.baseInfo')}</h2>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="text-muted-foreground">{t('table:table.schemaName')}</div>
        <div>{base.id}</div>
        <div className="text-muted-foreground">{t('table:table.typeOfDatabase')}</div>
        <div>{driver}</div>
        <div className="text-muted-foreground">{t('table:table.integrity.title')}</div>
        <div>
          <IntegrityButton />
        </div>
      </div>
    </div>
  );
};
