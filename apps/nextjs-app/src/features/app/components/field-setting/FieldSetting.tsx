import type {
  IFieldRo,
  IFieldVo,
  ILookupConditionalOptions,
  ILookupLinkOptions,
  ILookupOptionsRo,
  ILookupOptionsVo,
} from '@teable/core';
import {
  validateFieldOptions,
  convertFieldRoSchema,
  createFieldRoSchema,
  FieldType,
  getOptionsSchema,
  isConditionalLookupOptions,
  isLinkLookupOptions,
  StatisticsFunc,
} from '@teable/core';
import { type IPlanFieldConvertVo, getAggregation } from '@teable/openapi';
import { useTableId, useView, useFieldOperations, useRowCount } from '@teable/sdk/hooks';
import { ConfirmDialog, Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { Sheet, SheetContent } from '@teable/ui-lib/shadcn/ui/sheet';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useRef, useState } from 'react';
import { fromZodError } from 'zod-validation-error';
import { tableConfig } from '@/features/i18n/table.config';
import { DynamicFieldGraph } from '../../blocks/graph/DynamicFieldGraph';
import { ProgressBar } from '../../blocks/graph/ProgressBar';
import type { AiAutoFillMode } from './dialog/AiAutoFillDialog';
import { AiAutoFillDialog } from './dialog/AiAutoFillDialog';
import { DynamicFieldEditor } from './DynamicFieldEditor';
import { useDefaultFieldName } from './hooks/useDefaultFieldName';
import type { IFieldEditorRo, IFieldSetting, IFieldSettingBase } from './type';
import { FieldOperator } from './type';

const asNonEmptyString = (value: unknown) =>
  typeof value === 'string' && value ? value : undefined;

const sanitizeLinkLookupOptions = (options: ILookupLinkOptions): ILookupOptionsRo | undefined => {
  const foreignTableId = asNonEmptyString(options.foreignTableId);
  const lookupFieldId = asNonEmptyString(options.lookupFieldId);
  const linkFieldId = asNonEmptyString(options.linkFieldId);
  if (!foreignTableId || !lookupFieldId || !linkFieldId) {
    return undefined;
  }
  const sanitized: ILookupOptionsRo = {
    foreignTableId,
    lookupFieldId,
    linkFieldId,
  };
  if (options.filter != null) {
    sanitized.filter = options.filter;
  }
  return sanitized;
};

const sanitizeConditionalLookupOptions = (
  options: ILookupConditionalOptions
): ILookupOptionsRo | undefined => {
  const foreignTableId = asNonEmptyString(options.foreignTableId);
  const lookupFieldId = asNonEmptyString(options.lookupFieldId);
  const filter = options.filter;
  if (!foreignTableId || !lookupFieldId || !filter) {
    return undefined;
  }

  const sanitized: ILookupOptionsRo = {
    foreignTableId,
    lookupFieldId,
    filter,
  };

  const baseId = asNonEmptyString(options.baseId);
  if (baseId) {
    sanitized.baseId = baseId;
  }
  const sortFieldId = asNonEmptyString(options.sort?.fieldId);
  if (sortFieldId && options.sort) {
    sanitized.sort = options.sort;
  }
  if (typeof options.limit === 'number') {
    sanitized.limit = options.limit;
  }

  return sanitized;
};

export const sanitizeLookupOptions = (
  options?: ILookupOptionsRo | ILookupOptionsVo
): ILookupOptionsRo | undefined => {
  if (!options) {
    return undefined;
  }

  if (isLinkLookupOptions(options)) {
    return sanitizeLinkLookupOptions(options);
  }

  if (isConditionalLookupOptions(options)) {
    return sanitizeConditionalLookupOptions(options);
  }

  return undefined;
};

export const FieldSetting = (props: IFieldSetting) => {
  const { operator, order } = props;

  const view = useView();
  const tableId = useTableId() as string;
  const rowCount = useRowCount();
  const getDefaultFieldName = useDefaultFieldName();
  const { createField, convertField, planFieldCreate, planFieldConvert, autoFillField } =
    useFieldOperations();

  const [graphVisible, setGraphVisible] = useState<boolean>(false);
  const [processVisible, setProcessVisible] = useState<boolean>(false);
  const [plan, setPlan] = useState<IPlanFieldConvertVo>();
  const [fieldRo, setFieldRo] = useState<IFieldRo>();
  const [aiConfirmVisible, setAiConfirmVisible] = useState(false);
  const [aiFieldStats, setAiFieldStats] = useState<{
    emptyCount?: number;
    filledCount?: number;
    isLoading: boolean;
  }>({ isLoading: false });
  const autoFillModeRef = useRef<AiAutoFillMode | null>(null);
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  // Fetch field stats (empty/filled count) for AI field dialog
  const fetchFieldStats = async (fieldId: string) => {
    if (!tableId) return;

    setAiFieldStats({ isLoading: true });
    try {
      const query = view?.id ? { viewId: view.id } : {};
      const result = await getAggregation(tableId, {
        ...query,
        field: {
          [StatisticsFunc.Empty]: [fieldId],
          [StatisticsFunc.Filled]: [fieldId],
        },
      });

      const aggregations = result.data.aggregations;
      if (aggregations && aggregations.length > 0) {
        const parseValue = (value: string | number | null | undefined): number | undefined => {
          if (value == null) return undefined;
          return typeof value === 'string' ? parseInt(value, 10) : value;
        };

        // Find empty and filled stats from aggregations
        const emptyAgg = aggregations.find(
          (agg) => agg.fieldId === fieldId && agg.total?.aggFunc === StatisticsFunc.Empty
        );
        const filledAgg = aggregations.find(
          (agg) => agg.fieldId === fieldId && agg.total?.aggFunc === StatisticsFunc.Filled
        );

        setAiFieldStats({
          emptyCount: parseValue(emptyAgg?.total?.value),
          filledCount: parseValue(filledAgg?.total?.value),
          isLoading: false,
        });
      } else {
        setAiFieldStats({ isLoading: false });
      }
    } catch (e) {
      console.error('Failed to fetch field stats', e);
      setAiFieldStats({ isLoading: false });
    }
  };

  const runAutoFillIfNeeded = async (result?: IFieldVo) => {
    const mode = autoFillModeRef.current;
    if (!result || !mode || mode === 'saveOnly') {
      autoFillModeRef.current = null;
      return;
    }

    try {
      if (tableId && result.id) {
        // mode is either 'emptyOnly' or 'all' at this point (saveOnly already returned above)
        const apiMode = mode as 'emptyOnly' | 'all';
        const query = view?.id ? { viewId: view.id, mode: apiMode } : { mode: apiMode };
        await autoFillField({ tableId, fieldId: result.id, query });
      }
    } catch (e) {
      toast.error(t('table:field.aiConfig.autoFillConfirm.generateFailed'));
      console.error('autoFillField error', e);
    } finally {
      autoFillModeRef.current = null;
    }
  };

  const onCancel = () => {
    props.onCancel?.();
  };

  const createNewField = async (field: IFieldRo) => {
    const fieldName = field.name ?? (await getDefaultFieldName(field));
    return await createField({ tableId, fieldRo: { ...field, name: fieldName } });
  };

  const performAction = async (field: IFieldRo) => {
    setGraphVisible(false);
    if (plan && (plan.estimateTime || 0) > 1000) {
      setProcessVisible(true);
    }
    let result: IFieldVo | undefined;
    try {
      if (operator === FieldOperator.Add) {
        result = await createNewField(field);
      }

      if (operator === FieldOperator.Insert) {
        result = await createNewField({
          ...field,
          order:
            view && order != null
              ? {
                  viewId: view.id,
                  orderIndex: order,
                }
              : undefined,
        });
      }

      if (operator === FieldOperator.Edit) {
        const fieldId = props.field?.id;
        if (tableId && fieldId) {
          result = await convertField({ tableId, fieldId, fieldRo: field });
        }
      }

      toast(
        operator === FieldOperator.Edit
          ? t('table:field.editor.fieldUpdated')
          : t('table:field.editor.fieldCreated')
      );
    } finally {
      setProcessVisible(false);
    }

    await runAutoFillIfNeeded(result);

    props.onConfirm?.(result);
  };

  const getPlan = async (fieldRo: IFieldRo) => {
    if (operator === FieldOperator.Edit) {
      return await planFieldConvert({ tableId, fieldId: props.field?.id as string, fieldRo });
    }
    return await planFieldCreate({ tableId, fieldRo });
  };

  const onConfirm = async (fieldRo?: IFieldRo) => {
    if (!fieldRo) {
      return onCancel();
    }

    const hasAiConfig = Boolean(fieldRo.aiConfig?.isAutoFill);
    const originAiConfig = props.field?.aiConfig;
    const aiConfigChanged =
      JSON.stringify(originAiConfig ?? null) !== JSON.stringify(fieldRo.aiConfig ?? null);

    if (
      hasAiConfig &&
      (operator === FieldOperator.Add ||
        operator === FieldOperator.Insert ||
        (operator === FieldOperator.Edit && aiConfigChanged))
    ) {
      setFieldRo(fieldRo);
      setAiConfirmVisible(true);
      // Fetch field stats for edit mode (existing field)
      if (operator === FieldOperator.Edit && props.field?.id) {
        fetchFieldStats(props.field.id);
      } else {
        // For new fields, all cells are empty
        setAiFieldStats({ emptyCount: rowCount ?? 0, filledCount: 0, isLoading: false });
      }
      return;
    }

    const plan = await getPlan(fieldRo);
    setFieldRo(fieldRo);
    setPlan(plan);
    const estimateTime = plan?.estimateTime || 0;
    const linkFieldCount = plan?.linkFieldCount || 0;
    if (estimateTime > 1000 || linkFieldCount > 0) {
      setGraphVisible(true);
      return;
    }
    await performAction(fieldRo);
  };

  const handleConfirmWithAutoFill = async (mode: AiAutoFillMode) => {
    if (!fieldRo) return;
    autoFillModeRef.current = mode;

    const plan = await getPlan(fieldRo);
    setPlan(plan);
    const estimateTime = plan?.estimateTime || 0;
    const linkFieldCount = plan?.linkFieldCount || 0;
    if (estimateTime > 1000 || linkFieldCount > 0) {
      setGraphVisible(true);
      return;
    }
    await performAction(fieldRo);
  };

  return (
    <>
      <FieldSettingBase {...props} onCancel={onCancel} onConfirm={onConfirm} />
      <ConfirmDialog
        title={t('table:field.editor.confirmFieldChange')}
        open={graphVisible}
        onOpenChange={setGraphVisible}
        content={
          <>
            <DynamicFieldGraph tableId={tableId} fieldId={props.field?.id} fieldRo={fieldRo} />
            <p className="text-sm">{t('table:field.editor.areYouSurePerformIt')}</p>
          </>
        }
        cancelText={t('common:actions.cancel')}
        confirmText={t('common:actions.confirm')}
        onCancel={() => setGraphVisible(false)}
        onConfirm={() => performAction(fieldRo as IFieldRo)}
      />
      <AiAutoFillDialog
        open={aiConfirmVisible}
        title={t('table:field.aiConfig.autoFillConfirm.title')}
        rowCount={rowCount ?? 0}
        emptyCount={aiFieldStats.emptyCount}
        filledCount={aiFieldStats.filledCount}
        isLoadingStats={aiFieldStats.isLoading}
        cancelText={t('common:actions.cancel')}
        hideEmptyOnly={operator !== FieldOperator.Edit}
        labels={{
          description: t('table:field.aiConfig.autoFillConfirm.description'),
          emptyOnly: t('table:field.aiConfig.autoFillConfirm.emptyOnlyMode'),
          emptyOnlyDesc: t('table:field.aiConfig.autoFillConfirm.emptyOnlyModeDesc'),
          all: t('table:field.aiConfig.autoFillConfirm.allMode'),
          allDesc: t('table:field.aiConfig.autoFillConfirm.allModeDesc'),
          saveOnly: t('table:field.aiConfig.autoFillConfirm.saveOnlyMode'),
          saveOnlyDesc: t('table:field.aiConfig.autoFillConfirm.saveOnlyModeDesc'),
          recommended: t('table:field.aiConfig.autoFillConfirm.recommended'),
          limitWarning: t('table:field.aiConfig.autoFillConfirm.limitWarning'),
        }}
        confirmLabels={{
          emptyOnly: t('table:field.aiConfig.autoFillConfirm.fillEmptyCells'),
          all: t('table:field.aiConfig.autoFillConfirm.generateAll'),
          saveOnly: t('table:field.aiConfig.autoFillConfirm.saveConfigOnly'),
        }}
        onClose={() => setAiConfirmVisible(false)}
        onConfirm={async (mode) => {
          setAiConfirmVisible(false);
          await handleConfirmWithAutoFill(mode);
        }}
      />
      <ConfirmDialog
        open={processVisible}
        onOpenChange={setProcessVisible}
        title={t('table:field.editor.calculating')}
        content={
          <ProgressBar duration={plan?.estimateTime || 0} cellCount={plan?.updateCellCount || 0} />
        }
      />
    </>
  );
};

const FieldSettingBase = (props: IFieldSettingBase) => {
  const { visible, field: originField, operator, onConfirm, onCancel } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [field, setField] = useState<IFieldEditorRo>(
    originField
      ? {
          ...originField,
          options: getOptionsSchema(originField.type).parse(originField.options),
          lookupOptions: sanitizeLookupOptions(originField.lookupOptions),
        }
      : {
          type: FieldType.SingleLineText,
        }
  );
  const [alertVisible, setAlertVisible] = useState<boolean>(false);
  const [updateCount, setUpdateCount] = useState<number>(0);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const onOpenChange = (open?: boolean) => {
    if (open) {
      return;
    }
    onCancelInner();
  };

  const onFieldEditorChange = useCallback((nextField: IFieldEditorRo) => {
    const sanitizedLookupOptions = sanitizeLookupOptions(nextField.lookupOptions);
    const normalizedField: IFieldEditorRo = {
      ...nextField,
      lookupOptions:
        sanitizedLookupOptions ??
        (nextField.isConditionalLookup ? nextField.lookupOptions : undefined),
    };
    setField(normalizedField);
    setUpdateCount(1);
  }, []);

  const onCancelInner = () => {
    if (updateCount > 0) {
      setAlertVisible(true);
      return;
    }
    onCancel?.();
  };

  const onSave = async () => {
    if (operator === FieldOperator.Edit && !updateCount) {
      onConfirm?.();
      return;
    }

    const normalizedField: IFieldEditorRo = {
      ...field,
      lookupOptions: sanitizeLookupOptions(field.lookupOptions),
    };

    const validateRes = validateFieldOptions({
      type: normalizedField.type as FieldType,
      isLookup: normalizedField.isLookup,
      isConditionalLookup: normalizedField.isConditionalLookup,
      lookupOptions: normalizedField.lookupOptions,
      options: normalizedField.options,
      aiConfig: normalizedField.aiConfig,
    });
    if (validateRes.length > 0) {
      toast.error(
        t(validateRes[0].i18nKey, {
          ...validateRes[0].context,
          defaultValue: validateRes[0].message,
        })
      );
      return;
    }

    const fieldRoSchema =
      operator === FieldOperator.Edit ? convertFieldRoSchema : createFieldRoSchema;
    const result = fieldRoSchema.safeParse(normalizedField);
    if (result.success) {
      setIsSaving(true);
      try {
        await onConfirm?.(result.data);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    console.error('fieldConFirm', normalizedField);
    console.error('fieldConFirmResult', fromZodError(result.error).message);
    const errorMessage = fromZodError(result.error).message;
    toast.error(`Validation Error`, {
      description: errorMessage,
    });
  };

  const title = useMemo(() => {
    switch (operator) {
      case FieldOperator.Add:
        return t('table:field.editor.addField');
      case FieldOperator.Edit:
        return t('table:field.editor.editField');
      case FieldOperator.Insert:
        return t('table:field.editor.insertField');
    }
  }, [operator, t]);

  return (
    <>
      <Sheet open={visible} onOpenChange={onOpenChange}>
        <SheetContent
          className="w-screen p-0 sm:w-[400px] sm:max-w-[400px]"
          side="right"
          onInteractOutside={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('.toaster')) {
              event.preventDefault();
            }
          }}
        >
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="text-md w-full border-b px-4 py-3 font-semibold">{title}</div>
            {/* Content Form */}
            {
              <DynamicFieldEditor
                isPrimary={originField?.isPrimary}
                field={field}
                operator={operator}
                onChange={onFieldEditorChange}
                onSave={onSave}
              />
            }
            {/* Footer */}
            <div className="flex w-full shrink-0 justify-end gap-2 border-t p-4">
              <Button size={'sm'} variant={'ghost'} onClick={onCancel} disabled={isSaving}>
                {t('common:actions.cancel')}
              </Button>
              <Button size={'sm'} onClick={onSave} disabled={isSaving}>
                {isSaving ? <Spin className="size-4" /> : t('common:actions.save')}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={alertVisible}
        closeable={true}
        onOpenChange={setAlertVisible}
        title={t('table:field.editor.doSaveChanges')}
        onCancel={onCancel}
        cancelText={t('common:actions.doNotSave')}
        confirmText={t('common:actions.save')}
        onConfirm={onSave}
      />
    </>
  );
};
