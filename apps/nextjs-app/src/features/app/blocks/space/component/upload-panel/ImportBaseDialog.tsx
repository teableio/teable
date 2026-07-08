import { Airtable, FileText } from '@teable/icons';
import { UserIntegrationProvider } from '@teable/openapi';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { usePublicSettingQuery } from '@/features/app/hooks/useSetting';
import { spaceConfig } from '@/features/i18n/space.config';
import { AirtableImportDialog } from '../airtable-import';
import { UploadPanelDialog } from './UploadPanelDialog';

interface IImportBaseDialogProps {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type IImportSource = 'file' | 'airtable';

/**
 * Space-level "import" entry: first pick a source (a .tea file or an Airtable
 * base), then hand off to the matching importer. Both sources create a new base
 * in the space, so they live together under one "import" action instead of
 * being scattered across the menu.
 */
export const ImportBaseDialog = (props: IImportBaseDialogProps) => {
  const { spaceId, open, onOpenChange } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const [source, setSource] = React.useState<IImportSource | null>(null);
  const { data: publicSetting } = usePublicSettingQuery();
  // Airtable import needs the instance-level OAuth app (AIRTABLE_CLIENT_ID); without it
  // the card would only lead to a broken connect flow, so the file importer is the sole
  // source and the chooser step is skipped entirely.
  const airtableImportEnabled = !!publicSetting?.availableIntegrationProviders?.includes(
    UserIntegrationProvider.Airtable
  );
  const effectiveSource = source ?? (airtableImportEnabled ? null : 'file');

  // Reset the picked source once the whole flow is closed so reopening always
  // starts back at the chooser.
  React.useEffect(() => {
    if (!open) setSource(null);
  }, [open]);

  const closeAll = () => onOpenChange(false);

  return (
    <>
      <Dialog open={open && effectiveSource === null} onOpenChange={(next) => !next && closeAll()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('space:importBaseDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSource('file')}
              className="flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <FileText className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">{t('space:importBaseDialog.fromFile')}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t('space:importBaseDialog.fromFileDesc')}
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setSource('airtable')}
              className="flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Airtable className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">{t('space:airtableImport.title')}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t('space:importBaseDialog.fromAirtableDesc')}
                </div>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <UploadPanelDialog
        spaceId={spaceId}
        open={open && effectiveSource === 'file'}
        onOpenChange={(next) => !next && closeAll()}
      />
      <AirtableImportDialog
        spaceId={spaceId}
        open={open && effectiveSource === 'airtable'}
        onOpenChange={(next) => !next && closeAll()}
      />
    </>
  );
};
