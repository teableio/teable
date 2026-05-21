import { Plus } from '@teable/icons';
import { CreateRecordModal } from '@teable/sdk/components';
import { useIsReadOnlyPreview, useTablePermission } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

export const ToolBarAddRecordButton = () => {
  const permission = useTablePermission();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const isReadOnlyPreview = useIsReadOnlyPreview();

  if (isReadOnlyPreview) {
    return null;
  }

  return (
    <CreateRecordModal>
      <Button size={'xs'} variant={'outline'} disabled={!permission['record|create']}>
        <Plus className="size-4" />
        {t('table:view.addRecord')}
      </Button>
    </CreateRecordModal>
  );
};
