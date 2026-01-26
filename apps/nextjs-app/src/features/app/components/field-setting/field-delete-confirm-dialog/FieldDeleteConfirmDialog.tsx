import { deleteFields } from '@teable/openapi';
import { useFields } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { Spin } from '@teable/ui-lib/base';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Separator,
} from '@teable/ui-lib/shadcn';
import { Trans, useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { AffectedFieldsList } from './AffectedFieldsList';
import { FieldSelectionList } from './FieldSelectionList';
import type { FieldDeleteConfirmDialogProps } from './types';
import { useFieldSelectionState, useSingleFieldPlan } from './useDeleteAnalysis';

// Single field delete dialog content
const SingleFieldContent = ({
  tableId,
  fieldId,
  fieldName,
  open,
}: {
  tableId: string;
  fieldId: string;
  fieldName: string;
  open: boolean;
}) => {
  const { t } = useTranslation(['table']);
  const fieldInstances = useFields({ withHidden: true, withDenied: true });
  const { affectedFields, isLoading } = useSingleFieldPlan(tableId, fieldId, open, fieldInstances);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spin />
      </div>
    );
  }

  if (affectedFields.length === 0) {
    return (
      <AlertDialogDescription>
        <Trans
          ns="table"
          i18nKey="field.editor.deleteField.simpleConfirm"
          components={{ b: <b /> }}
          values={{ fieldName }}
        />
      </AlertDialogDescription>
    );
  }

  return (
    <AlertDialogDescription asChild>
      <div className="space-y-2">
        <p>
          <Trans
            ns="table"
            i18nKey="field.editor.deleteField.withDependencies"
            components={{ b: <b /> }}
            values={{ fieldName }}
          />
        </p>
        <p className="text-sm font-medium">{t('table:field.editor.deleteField.affectedFields')}</p>
        <AffectedFieldsList fields={affectedFields} />
      </div>
    </AlertDialogDescription>
  );
};

// Multi field delete dialog content
const MultiFieldContent = ({
  tableId,
  targetFields,
  selectedFieldId,
  viewedFieldIds,
  onSelect,
  markAsViewed,
  open,
}: {
  tableId: string;
  targetFields: IFieldInstance[];
  selectedFieldId: string | null;
  viewedFieldIds: Set<string>;
  onSelect: (fieldId: string) => void;
  markAsViewed: (fieldId: string) => void;
  open: boolean;
}) => {
  const { t } = useTranslation(['table']);

  const selectedField = useMemo(
    () => targetFields.find((f) => f.id === selectedFieldId),
    [targetFields, selectedFieldId]
  );

  return (
    <AlertDialogDescription asChild>
      <div className="flex gap-4">
        {/* Left panel - field list */}
        <div className="w-40 shrink-0">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {t('table:field.editor.deleteField.fieldsToDelete', { count: targetFields.length })}
          </p>
          <FieldSelectionList
            fields={targetFields}
            selectedFieldId={selectedFieldId}
            viewedFieldIds={viewedFieldIds}
            onSelect={onSelect}
          />
        </div>

        <Separator orientation="vertical" className="h-auto" />

        {/* Right panel - detail */}
        <div className="min-h-32 flex-1 overflow-hidden">
          {selectedFieldId && selectedField && (
            <DetailPanel
              tableId={tableId}
              fieldId={selectedFieldId}
              fieldName={selectedField.name}
              open={open}
              markAsViewed={markAsViewed}
            />
          )}
        </div>
      </div>
    </AlertDialogDescription>
  );
};

// Detail panel for multi field mode
const DetailPanel = ({
  tableId,
  fieldId,
  fieldName,
  open,
  markAsViewed,
}: {
  tableId: string;
  fieldId: string;
  fieldName: string;
  open: boolean;
  markAsViewed: (fieldId: string) => void;
}) => {
  const { t } = useTranslation(['table']);
  const fieldInstances = useFields({ withHidden: true, withDenied: true });
  const { affectedFields, isLoading, isLoaded } = useSingleFieldPlan(
    tableId,
    fieldId,
    open,
    fieldInstances
  );

  // Mark as viewed when loaded
  useEffect(() => {
    if (isLoaded) {
      markAsViewed(fieldId);
    }
  }, [isLoaded, fieldId, markAsViewed]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-4">
        <Spin />
      </div>
    );
  }

  if (affectedFields.length === 0) {
    return (
      <div className="flex-1">
        <p className="text-sm text-muted-foreground">
          {t('table:field.editor.deleteField.noAffectedFields')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-2">
      <p className="text-sm">
        <Trans
          ns="table"
          i18nKey="field.editor.deleteField.withDependencies"
          components={{ b: <b /> }}
          values={{ fieldName }}
        />
      </p>
      <p className="text-sm font-medium">{t('table:field.editor.deleteField.affectedFields')}</p>
      <AffectedFieldsList fields={affectedFields} />
    </div>
  );
};

export const FieldDeleteConfirmDialog = (props: FieldDeleteConfirmDialogProps) => {
  const { tableId, fieldIds, open, onClose } = props;
  const { t } = useTranslation(['common', 'table']);
  const [isDeleting, setIsDeleting] = useState(false);
  const allFields = useFields({ withHidden: true, withDenied: true });

  const targetFields = useMemo(
    () => allFields.filter((f) => fieldIds.includes(f.id)),
    [allFields, fieldIds]
  );

  const isMultiField = fieldIds.length > 1;

  // Lift state up for multi-field mode
  const { selectedFieldId, viewedFieldIds, unviewedCount, selectField, markAsViewed } =
    useFieldSelectionState(fieldIds);

  const close = () => {
    setIsDeleting(false);
    onClose?.();
  };

  const actionDelete = async () => {
    if (isDeleting) return;
    try {
      setIsDeleting(true);
      await deleteFields(tableId, fieldIds);
      close();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent
        className={isMultiField ? 'max-w-lg' : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <AlertDialogHeader className="overflow-hidden">
          <AlertDialogTitle>{t('table:field.editor.deleteField.title')}</AlertDialogTitle>
          {isMultiField ? (
            <MultiFieldContent
              tableId={tableId}
              targetFields={targetFields}
              selectedFieldId={selectedFieldId}
              viewedFieldIds={viewedFieldIds}
              onSelect={selectField}
              markAsViewed={markAsViewed}
              open={open}
            />
          ) : (
            <SingleFieldContent
              tableId={tableId}
              fieldId={fieldIds[0]}
              fieldName={targetFields[0]?.name ?? ''}
              open={open}
            />
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {isMultiField && unviewedCount > 0 && (
            <p className="mr-auto text-xs text-muted-foreground">
              {t('table:field.editor.deleteField.unviewedHint', { count: unviewedCount })}
            </p>
          )}
          <AlertDialogCancel disabled={isDeleting}>{t('common:actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              actionDelete();
            }}
            disabled={isDeleting}
          >
            {isDeleting && <Spin className="mr-1" />}
            {isMultiField
              ? t('table:field.editor.deleteField.deleteCount', { count: fieldIds.length })
              : t('common:actions.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
