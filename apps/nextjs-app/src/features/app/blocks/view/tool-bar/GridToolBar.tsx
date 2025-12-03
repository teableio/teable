import { Plus } from '@teable/icons';
import { CreateRecordModal } from '@teable/sdk/components';
import { useTablePermission } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { GridViewOperators } from './components';
import { useViewConfigurable } from './hook';
import { Others } from './Others';

export const GridToolBar: React.FC = () => {
  const permission = useTablePermission();
  const { isViewConfigurable } = useViewConfigurable();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return (
    <div className="flex items-center border-t px-1 py-2 h-[48px] sm:gap-1 sm:px-2 md:gap-2 md:px-4">
      <CreateRecordModal>
        <Button size={'xs'} variant={'outline'} disabled={!permission['record|create']}>
          <Plus className="size-4" />
          {t('table:view.addRecord')}
        </Button>
      </CreateRecordModal>
      <div className="flex flex-1 justify-between @container/toolbar">
        <GridViewOperators disabled={!isViewConfigurable} />
        <Others />
      </div>
    </div>
  );
};
