import {
  BaseNodeResourceType,
  deleteField,
  deleteFields,
  type IBaseNodeTableResourceMeta,
} from '@teable/openapi';
import { useBase, useBaseId, useFields } from '@teable/sdk/hooks';
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
  Button,
  Separator,
} from '@teable/ui-lib/shadcn';
import type { IOperationPreviewDto } from '@teable/v2-contract-http/operationPreview';
import { Trans, useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  OperationPreviewPanel,
  useOperationPreview,
} from '@/features/app/components/operation-preview';
import { useEnv } from '@/features/app/hooks/useEnv';
import { FieldDeleteImpact, useFieldImpactConfirmation } from '@overridable/FieldDeleteImpact';
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
  affectedItems,
  isLoading,
  hasCanonicalPreview = false,
}: {
  tableId: string;
  fieldId: string;
  fieldName: string;
  affectedItems: AffectedItem[];
  isLoading: boolean;
  hasCanonicalPreview?: boolean;
}) => {
  const loginApps = useLoginAppsForField(tableId, fieldId);
  const { t } = useTranslation(['table']);

  if (hasCanonicalPreview && affectedItems.length === 0 && !loginApps) return null;

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

  const selectedItems = selectedFieldId ? (fieldRiskMap.get(selectedFieldId) ?? []) : [];

  return (
    <AlertDialogDescription asChild>
      <div className="flex items-start gap-4">
        {/* Left panel - field list */}
        <div className="w-48 shrink-0">
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

        <Separator orientation="vertical" className="h-auto self-stretch" />

        {/* Right panel - detail */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
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
    return (
      <p className="text-sm text-muted-foreground">
        {t('table:field.editor.deleteField.noReferencesFound')}
      </p>
    );
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

/** Readiness belongs to the exact checked subset, never a previous impact response. */
const useFieldImpactReadiness = (tableId: string, fieldIds: string[], updatedAt: number) => {
  const required = useFieldImpactConfirmation();
  const [assessment, setAssessment] = useState<{ key: string; ready: boolean }>();
  const candidateKey = JSON.stringify({ tableId, fieldIds, updatedAt });
  const onReadyChange = useCallback(
    (ready: boolean) => setAssessment({ key: candidateKey, ready }),
    [candidateKey]
  );
  const canConfirm = !required || (assessment?.key === candidateKey && assessment.ready);
  return { candidateKey, onReadyChange, canConfirm };
};

type FieldDeleteDialogSelection = {
  isMultiField: boolean;
  targetFields: IFieldInstance[];
  selectedFieldId: string | null;
  checkedFieldIds: Set<string>;
  fieldRiskMap: Map<string, AffectedItem[]>;
  isLoading: boolean;
  selectField: (fieldId: string) => void;
  toggleField: (fieldId: string) => void;
};

type FieldDeleteDialogImpact = {
  enabled: boolean;
  targetFieldName?: string;
  data?: IOperationPreviewDto;
  error: unknown;
  pending: boolean;
  updatedAt: number;
  refetch: () => void;
  candidateKey: string;
  fieldIds: string[];
  fieldNames: Record<string, string>;
  confirmationContainer: HTMLDivElement | null;
  onReadyChange: (ready: boolean) => void;
};

type FieldDeleteDialogReferences = {
  hasError: boolean;
  retry: () => void;
  items: AffectedItem[];
};

/** Header presentation only: selection, preview and reference state stay in the dialog. */
const FieldDeleteDialogBody = ({
  tableId,
  fieldId,
  selection,
  impact,
  references,
}: {
  tableId: string;
  fieldId: string;
  selection: FieldDeleteDialogSelection;
  impact: FieldDeleteDialogImpact;
  references: FieldDeleteDialogReferences;
}) => {
  const { t } = useTranslation(['common', 'table']);

  if (references.hasError) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t('table:field.editor.deleteField.referencesFailed')}</p>
        <Button type="button" size="sm" variant="outline" onClick={references.retry}>
          {t('common:actions.retry')}
        </Button>
      </div>
    );
  }

  return (
    <>
      {selection.isMultiField ? (
        <MultiFieldContent
          tableId={tableId}
          targetFields={selection.targetFields}
          selectedFieldId={selection.selectedFieldId}
          checkedFieldIds={selection.checkedFieldIds}
          fieldRiskMap={selection.fieldRiskMap}
          isLoading={selection.isLoading}
          onSelect={selection.selectField}
          onToggleCheck={selection.toggleField}
        />
      ) : (
        <SingleFieldContent
          tableId={tableId}
          fieldId={fieldId}
          fieldName={selection.targetFields[0]?.name ?? ''}
          affectedItems={(selection.fieldRiskMap.get(fieldId) ?? []).filter(
            (item) => !impact.enabled || (item.itemType !== 'field' && item.itemType !== 'view')
          )}
          isLoading={selection.isLoading}
          hasCanonicalPreview={impact.enabled}
        />
      )}
      {impact.enabled && (
        <OperationPreviewPanel
          preview={impact.data}
          error={impact.error}
          isLoading={impact.pending}
          onRetry={() => impact.refetch()}
          targetFieldName={impact.targetFieldName}
        >
          <FieldDeleteImpact
            key={impact.candidateKey}
            open={impact.enabled}
            tableId={tableId}
            fieldIds={impact.fieldIds}
            fieldNames={impact.fieldNames}
            confirmationContainer={impact.confirmationContainer}
            preview={{
              data: impact.data,
              pending: impact.pending,
              error: impact.error,
              refetch: impact.refetch,
              updatedAt: impact.updatedAt,
            }}
            onReadyChange={impact.onReadyChange}
          />
        </OperationPreviewPanel>
      )}
      {impact.enabled && !selection.isMultiField && references.items.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {t('table:field.editor.deleteField.affectedItems')} ({references.items.length})
          </summary>
          <div className="mt-2">
            <AffectedFieldsList items={references.items} />
          </div>
        </details>
      )}
    </>
  );
};

export const FieldDeleteConfirmDialog = (props: FieldDeleteConfirmDialogProps) => {
  const { tableId, fieldIds, open, onClose } = props;
  const { t } = useTranslation(['common', 'table']);
  const [isDeleting, setIsDeleting] = useState(false);
  const [impactConfirmationContainer, setImpactConfirmationContainer] =
    useState<HTMLDivElement | null>(null);
  const baseId = useBaseId();
  const base = useBase();
  const { forceV2All } = useEnv();
  const allFields = useFields({ withHidden: true, withDenied: true });

  const targetFields = useMemo(
    () => allFields.filter((f) => fieldIds.includes(f.id)),
    [allFields, fieldIds]
  );

  const isMultiField = fieldIds.length > 1;
  const useV2 = Boolean(forceV2All || (base.v2Status?.useV2 ?? base.isCanary));
  const requiresImpact = useFieldImpactConfirmation();

  // State for multi-field mode
  const { selectedFieldId, selectField } = useFieldSelectionState(fieldIds);
  const { checkedFieldIds, toggleField } = useFieldCheckState(fieldIds, open);
  const { fieldRiskMap, isLoading, isAllLoaded, hasError, refetch } = useMultiFieldReferences(
    tableId,
    fieldIds,
    open
  );
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
  const impactFieldIds = useMemo(
    () => (isMultiField ? fieldIds.filter((id) => checkedFieldIds.has(id)) : fieldIds),
    [isMultiField, checkedFieldIds, fieldIds]
  );
  const previewEnabled =
    open && (useV2 || requiresImpact) && Boolean(baseId && tableId && impactFieldIds.length);
  const preview = useOperationPreview(
    {
      operation: 'field.delete',
      input: { baseId, tableId, fieldIds: impactFieldIds },
      options: { detail: 'full' },
    },
    previewEnabled
  );
  const impact = useFieldImpactReadiness(tableId, impactFieldIds, preview.dataUpdatedAt);
  const canDelete =
    deleteCount > 0 &&
    isAllLoaded &&
    (!(useV2 || requiresImpact) || preview.canConfirm) &&
    impact.canConfirm;
  const fieldNames = useMemo(
    () => Object.fromEntries(targetFields.map((field) => [field.id, field.name])),
    [targetFields]
  );
  const fieldReferences = (fieldRiskMap.get(fieldIds[0]) ?? []).filter(
    (item) => item.itemType === 'field' || item.itemType === 'view'
  );

  const close = () => {
    setIsDeleting(false);
    onClose?.();
  };

  const actionDelete = async () => {
    if (isDeleting || !canDelete) return;
    try {
      setIsDeleting(true);
      const idsToDelete = impactFieldIds;
      if (isMultiField) {
        await deleteFields(tableId, idsToDelete);
      } else {
        await deleteField(tableId, idsToDelete[0]);
      }
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
            ? 'flex h-[480px] max-h-[calc(100dvh-2rem)] max-w-5xl flex-col overflow-hidden'
            : 'flex max-h-[min(560px,calc(100dvh-2rem))] max-w-xl flex-col overflow-hidden'
        }
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('table:field.editor.deleteField.title')}</AlertDialogTitle>
            <FieldDeleteDialogBody
              tableId={tableId}
              fieldId={fieldIds[0]}
              selection={{
                isMultiField,
                targetFields,
                selectedFieldId,
                checkedFieldIds,
                fieldRiskMap,
                isLoading,
                selectField,
                toggleField,
              }}
              impact={{
                enabled: previewEnabled,
                targetFieldName: targetFields[0]?.name,
                data: preview.data,
                error: preview.error,
                pending: preview.isPending || preview.isFetching,
                updatedAt: preview.dataUpdatedAt,
                refetch: preview.refetch,
                candidateKey: impact.candidateKey,
                fieldIds: impactFieldIds,
                fieldNames,
                confirmationContainer: impactConfirmationContainer,
                onReadyChange: impact.onReadyChange,
              }}
              references={{ hasError, retry: refetch, items: fieldReferences }}
            />
          </AlertDialogHeader>
        </div>
        <div ref={setImpactConfirmationContainer} className="shrink-0 text-start" />
        <AlertDialogFooter className="shrink-0">
          <AlertDialogCancel disabled={isDeleting}>{t('common:actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              actionDelete();
            }}
            disabled={isDeleting || !canDelete}
          >
            {isDeleting && <Spin className="me-1" />}
            {isMultiField
              ? t('table:field.editor.deleteField.deleteCount', { count: deleteCount })
              : t('common:actions.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
