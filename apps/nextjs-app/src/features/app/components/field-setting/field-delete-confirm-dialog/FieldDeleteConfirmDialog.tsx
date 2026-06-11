import {
  BaseNodeResourceType,
  deleteFields,
  type IBaseNodeTableResourceMeta,
} from '@teable/openapi';
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
import { ShieldCheck } from 'lucide-react';
import { Trans, useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { useBaseNodeContext } from '../../../blocks/base/base-node/hooks/useBaseNodeContext';
import { LoginAppWarning } from '../../../components/LoginAppWarning';
import { AffectedFieldsList } from './AffectedFieldsList';
import { FieldSelectionList } from './FieldSelectionList';
import type { AffectedItem, FieldDeleteConfirmDialogProps } from './types';
import {
  useFieldCheckState,
  useFieldSelectionState,
  useMultiFieldReferences,
} from './useDeleteAnalysis';

const useLoginAppsForField = (tableId: string, fieldId?: string) => {
  const { treeItems } = useBaseNodeContext();
  return useMemo(() => {
    if (!fieldId) return undefined;
    const node = Object.values(treeItems).find(
      (n) => n.resourceType === BaseNodeResourceType.Table && n.resourceId === tableId
    );
    const meta = node?.resourceMeta as IBaseNodeTableResourceMeta | undefined;
    const apps = meta?.loginApps?.filter((a) => a.emailFieldId === fieldId);
    return apps?.length ? apps : undefined;
  }, [treeItems, tableId, fieldId]);
};

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
  const { fieldRiskMap, isLoading } = useMultiFieldReferences(tableId, [fieldId], open);
  const affectedItems = fieldRiskMap.get(fieldId) ?? [];
  const loginApps = useLoginAppsForField(tableId, fieldId);
  const { t } = useTranslation(['table']);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spin />
      </div>
    );
  }

  if (affectedItems.length === 0 && !loginApps) {
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
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {loginApps && (
          <LoginAppWarning
            message={t('table:field.editor.deleteField.loginEmailFieldWarning')}
            apps={loginApps}
          />
        )}
        {affectedItems.length > 0 && (
          <>
            <p className="shrink-0 text-foreground">
              <Trans
                ns="table"
                i18nKey="field.editor.deleteField.withDependencies"
                components={{ b: <b /> }}
                values={{ fieldName }}
              />
            </p>
            <AffectedFieldsList items={affectedItems} />
          </>
        )}
      </div>
    </AlertDialogDescription>
  );
};

// Safe to delete state component
const SafeToDeleteState = () => {
  const { t } = useTranslation(['table']);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <ShieldCheck className="size-12 text-muted-foreground" />
      <div className="flex flex-col items-center gap-2">
        <p className="text-base font-medium text-foreground">
          {t('table:field.editor.deleteField.safeToDelete')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('table:field.editor.deleteField.safeToDeleteDesc')}
        </p>
      </div>
    </div>
  );
};

// Multi field delete dialog content
const MultiFieldContent = ({
  tableId,
  targetFields,
  selectedFieldId,
  checkedFieldIds,
  fieldRiskMap,
  isLoading,
  onSelect,
  onToggleCheck,
}: {
  tableId: string;
  targetFields: IFieldInstance[];
  selectedFieldId: string | null;
  checkedFieldIds: Set<string>;
  fieldRiskMap: Map<string, AffectedItem[]>;
  isLoading: boolean;
  onSelect: (fieldId: string) => void;
  onToggleCheck: (fieldId: string) => void;
}) => {
  const selectedField = useMemo(
    () => targetFields.find((f) => f.id === selectedFieldId),
    [targetFields, selectedFieldId]
  );

  const selectedItems = selectedFieldId ? fieldRiskMap.get(selectedFieldId) ?? [] : [];

  return (
    <AlertDialogDescription asChild>
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left panel - field list */}
        <div className="w-48 shrink-0 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Spin />
            </div>
          ) : (
            <FieldSelectionList
              fields={targetFields}
              selectedFieldId={selectedFieldId}
              checkedFieldIds={checkedFieldIds}
              fieldRiskMap={fieldRiskMap}
              onSelect={onSelect}
              onToggleCheck={onToggleCheck}
            />
          )}
        </div>

        <Separator orientation="vertical" className="h-auto" />

        {/* Right panel - detail */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center py-4">
              <Spin />
            </div>
          ) : selectedFieldId && selectedField ? (
            <DetailPanel
              tableId={tableId}
              fieldId={selectedFieldId}
              fieldName={selectedField.name}
              affectedItems={selectedItems}
            />
          ) : null}
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
  affectedItems,
}: {
  tableId: string;
  fieldId: string;
  fieldName: string;
  affectedItems: AffectedItem[];
}) => {
  const loginApps = useLoginAppsForField(tableId, fieldId);
  const { t } = useTranslation(['table']);

  if (affectedItems.length === 0 && !loginApps) {
    return <SafeToDeleteState />;
  }

  return (
    <>
      {loginApps && (
        <LoginAppWarning
          message={t('table:field.editor.deleteField.loginEmailFieldWarning')}
          apps={loginApps}
        />
      )}
      {affectedItems.length > 0 && (
        <>
          <p className="shrink-0 text-sm text-foreground">
            <Trans
              ns="table"
              i18nKey="field.editor.deleteField.withDependencies"
              components={{ b: <b /> }}
              values={{ fieldName }}
            />
          </p>
          <AffectedFieldsList items={affectedItems} isMultiField />
        </>
      )}
    </>
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

  // State for multi-field mode
  const { selectedFieldId, selectField } = useFieldSelectionState(fieldIds);
  const { checkedFieldIds, toggleField } = useFieldCheckState(fieldIds, open);
  const { fieldRiskMap, isLoading, isAllLoaded } = useMultiFieldReferences(tableId, fieldIds, open);
  const [hasInitialSelected, setHasInitialSelected] = useState(false);

  // Select first field in grouped order (risk fields first) after loading - only once
  useEffect(() => {
    if (!isAllLoaded || !isMultiField || hasInitialSelected) return;

    const riskFieldId = targetFields.find((f) => {
      const affected = fieldRiskMap.get(f.id) ?? [];
      return affected.length > 0;
    })?.id;

    const firstFieldId = riskFieldId ?? targetFields[0]?.id;
    if (firstFieldId) {
      selectField(firstFieldId);
      setHasInitialSelected(true);
    }
  }, [isAllLoaded, isMultiField, targetFields, fieldRiskMap, selectField, hasInitialSelected]);

  // Reset initial selection flag when dialog reopens
  useEffect(() => {
    if (!open) {
      setHasInitialSelected(false);
    }
  }, [open]);

  const deleteCount = checkedFieldIds.size;
  const canDelete = deleteCount > 0;

  const close = () => {
    setIsDeleting(false);
    onClose?.();
  };

  const actionDelete = async () => {
    if (isDeleting || !canDelete) return;
    try {
      setIsDeleting(true);
      const idsToDelete = isMultiField ? Array.from(checkedFieldIds) : fieldIds;
      await deleteFields(tableId, idsToDelete);
      close();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent
        className={
          isMultiField
            ? 'flex h-[480px] max-w-5xl flex-col'
            : 'flex max-h-[560px] max-w-xl flex-col'
        }
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <AlertDialogHeader className="min-h-0 flex-1 overflow-hidden">
          <AlertDialogTitle>{t('table:field.editor.deleteField.title')}</AlertDialogTitle>
          {isMultiField ? (
            <MultiFieldContent
              tableId={tableId}
              targetFields={targetFields}
              selectedFieldId={selectedFieldId}
              checkedFieldIds={checkedFieldIds}
              fieldRiskMap={fieldRiskMap}
              isLoading={isLoading}
              onSelect={selectField}
              onToggleCheck={toggleField}
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
          <AlertDialogCancel disabled={isDeleting}>{t('common:actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              actionDelete();
            }}
            disabled={isDeleting || !canDelete}
          >
            {isDeleting && <Spin className="mr-1" />}
            {isMultiField
              ? t('table:field.editor.deleteField.deleteCount', { count: deleteCount })
              : t('common:actions.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
