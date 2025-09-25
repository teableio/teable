import type { IFieldRo, IFieldVo } from '@teable/core';
import {
  validateFieldOptions,
  convertFieldRoSchema,
  createFieldRoSchema,
  FieldType,
  getOptionsSchema,
} from '@teable/core';
import { Share2 } from '@teable/icons';
import { type IPlanFieldConvertVo } from '@teable/openapi';
import { useTable, useTableId, useView, useFieldOperations } from '@teable/sdk/hooks';
import { ConfirmDialog, Spin } from '@teable/ui-lib/base';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { Sheet, SheetContent } from '@teable/ui-lib/shadcn/ui/sheet';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { fromZodError } from 'zod-validation-error';
import { tableConfig } from '@/features/i18n/table.config';
import { DynamicFieldGraph } from '../../blocks/graph/DynamicFieldGraph';
import { ProgressBar } from '../../blocks/graph/ProgressBar';
import { DynamicFieldEditor } from './DynamicFieldEditor';
import { useDefaultFieldName } from './hooks/useDefaultFieldName';
import type { IFieldEditorRo, IFieldSetting, IFieldSettingBase } from './type';
import { FieldOperator } from './type';
export const FieldSetting = (props: IFieldSetting) => {
  const { operator, order } = props;

  const view = useView();
  const tableId = useTableId() as string;
  const getDefaultFieldName = useDefaultFieldName();
  const { createField, convertField, planFieldCreate, planFieldConvert } = useFieldOperations();

  const [graphVisible, setGraphVisible] = useState<boolean>(false);
  const [processVisible, setProcessVisible] = useState<boolean>(false);
  const [plan, setPlan] = useState<IPlanFieldConvertVo>();
  const [fieldRo, setFieldRo] = useState<IFieldRo>();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

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

  return (
    <>
      <FieldSettingBase {...props} onCancel={onCancel} onConfirm={onConfirm} />
      <ConfirmDialog
        contentClassName="max-w-6xl"
        title={t('table:field.editor.previewDependenciesGraph')}
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
  const table = useTable();
  const [field, setField] = useState<IFieldEditorRo>(
    originField
      ? { ...originField, options: getOptionsSchema(originField.type).parse(originField.options) }
      : {
          type: FieldType.SingleLineText,
        }
  );
  const [alertVisible, setAlertVisible] = useState<boolean>(false);
  const [updateCount, setUpdateCount] = useState<number>(0);
  const [showGraphButton, setShowGraphButton] = useState<boolean>(operator === FieldOperator.Edit);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const isCreatingSimpleField = useCallback(
    (field: IFieldEditorRo) => {
      return (
        !field.lookupOptions &&
        field.type !== FieldType.Link &&
        field.type !== FieldType.Formula &&
        operator !== FieldOperator.Edit
      );
    },
    [operator]
  );

  const checkFieldReady = useCallback(
    (field: IFieldEditorRo) => {
      const result = convertFieldRoSchema.safeParse(field);
      if (!result.success) {
        return false;
      }
      const data = result.data;
      if (isCreatingSimpleField(data)) {
        return false;
      }
      return true;
    },
    [isCreatingSimpleField]
  );

  const onOpenChange = (open?: boolean) => {
    if (open) {
      return;
    }
    onCancelInner();
  };

  const onFieldEditorChange = useCallback(
    (field: IFieldEditorRo) => {
      setField(field);
      setUpdateCount(1);
      setShowGraphButton(checkFieldReady(field));
    },
    [checkFieldReady]
  );

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

    const validateRes = validateFieldOptions({
      type: field.type as FieldType,
      isLookup: field.isLookup,
      lookupOptions: field.lookupOptions,
      options: field.options,
      aiConfig: field.aiConfig,
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
    const result = fieldRoSchema.safeParse(field);
    if (result.success) {
      setIsSaving(true);
      try {
        await onConfirm?.(result.data);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    console.error('fieldConFirm', field);
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
        <SheetContent className="w-screen p-0 sm:w-[400px] sm:max-w-[400px]" side="right">
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
            <div className="flex w-full shrink-0 justify-between p-4">
              <div>
                {showGraphButton && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size={'sm'} variant={'outline'}>
                        <Share2 className="size-4" /> {t('table:field.editor.graph')}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-6xl">
                      <DynamicFieldGraph
                        tableId={table?.id as string}
                        fieldId={props.field?.id}
                        fieldRo={updateCount ? (field as IFieldRo) : undefined}
                      />
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button type="button" variant="secondary">
                            {t('common:actions.close')}
                          </Button>
                        </DialogClose>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <div className="flex gap-2">
                <Button size={'sm'} variant={'ghost'} onClick={onCancel} disabled={isSaving}>
                  {t('common:actions.cancel')}
                </Button>
                <Button size={'sm'} onClick={onSave} disabled={isSaving}>
                  {isSaving ? <Spin className="size-4" /> : t('common:actions.save')}
                </Button>
              </div>
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
