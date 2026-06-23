import { useMutation } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import { Airtable, Plus } from '@teable/icons';
import { createBase } from '@teable/openapi';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { AirtableImportDialog } from '../../../blocks/space/component/airtable-import';
import { useBaseList } from '../../../blocks/space/useBaseList';

/**
 * Retired: the Airtable importer now lives in each base's "import from other
 * source" menu (next to CSV/Excel) and imports into the open base, so the
 * space-level create-base buttons always create a blank base directly instead
 * of opening the "how do you want to start" chooser.
 */
export const useCreateBaseChooserEnabled = () => false;

interface ICreateBaseDialogProps {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Shared "how do you want to start" chooser used by every create-base
 * entry point: start from scratch or import from Airtable.
 */
export const CreateBaseDialog = (props: ICreateBaseDialogProps) => {
  const { spaceId, open, onOpenChange } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const router = useRouter();
  const bases = useBaseList();
  const [importAirtableOpen, setImportAirtableOpen] = React.useState(false);

  const { mutate: createBaseMutator, isPending: isCreating } = useMutation({
    mutationFn: createBase,
    onSuccess: ({ data }) => {
      onOpenChange(false);
      router.push({
        pathname: '/base/[baseId]',
        query: { baseId: data.id },
      });
    },
  });

  const handleCreateBlank = () => {
    if (isCreating) return;
    const namesInSpace = bases?.filter((base) => base.spaceId === spaceId).map((base) => base.name);
    createBaseMutator({
      spaceId,
      name: getUniqName(t('common:noun.base'), namesInSpace || []),
    });
  };

  const handleImportAirtable = () => {
    onOpenChange(false);
    setImportAirtableOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('space:createBaseDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={isCreating}
              onClick={handleCreateBlank}
              className="flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Plus className="size-5" />
              </div>
              <div className="text-sm font-medium">{t('space:action.startFromScratch')}</div>
            </button>
            <button
              type="button"
              onClick={handleImportAirtable}
              className="flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Airtable className="size-5" />
              </div>
              <div className="text-sm font-medium">{t('space:airtableImport.title')}</div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AirtableImportDialog
        spaceId={spaceId}
        open={importAirtableOpen}
        onOpenChange={setImportAirtableOpen}
      />
    </>
  );
};
