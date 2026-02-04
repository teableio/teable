import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { DynamicDownloadContent } from './DynamicDownloadContent';
import { useColumnDownloadDialogStore } from './useDownloadAttachmentsStore';

export const DownloadAllAttachmentsDialog = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const {
    open,
    tableId,
    fieldId,
    fieldName,
    viewId,
    shareId,
    personalViewCommonQuery,
    closeDialog,
  } = useColumnDownloadDialogStore();

  if (!open || !tableId || !fieldId || !fieldName) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && closeDialog()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('table:download.allAttachments.title')}</DialogTitle>
        </DialogHeader>
        <DynamicDownloadContent
          tableId={tableId}
          fieldId={fieldId}
          fieldName={fieldName}
          viewId={viewId}
          shareId={shareId}
          personalViewCommonQuery={personalViewCommonQuery}
          onClose={closeDialog}
        />
      </DialogContent>
    </Dialog>
  );
};
