import { useQueryClient } from '@tanstack/react-query';
import type { IFieldRo } from '@teable/core';
import { convertFieldRoSchema, FieldType, getOptionsSchema } from '@teable/core';
import { Share2 } from '@teable/icons';
import { planFieldCreate, type IPlanFieldConvertVo, planFieldConvert } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTable, useView } from '@teable/sdk/hooks';
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

  const table = useTable();
  const view = useView();
  const getDefaultFieldName = useDefaultFieldName();

  const [graphVisible, setGraphVisible] = useState<boolean>(false);
  const [processVisible, setProcessVisible] = useState<boolean>(false);
  const [plan, setPlan] = useState<IPlanFieldConvertVo>();
  const [fieldRo, setFieldRo] = useState<IFieldRo>();
  const queryClient = useQueryClient();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const onCancel = () => {
    props.onCancel?.();
  };

  const createNewField = async (field: IFieldRo) => {
    const fieldName = field.name ?? (await getDefaultFieldName(field));
    return await table?.createField({ ...field, name: fieldName });
  };

  const performAction = async (field: IFieldRo) => {
    setGraphVisible(false);
    if (plan && (plan.estimateTime || 0) > 1000) {
      setProcessVisible(true);
    }
    try {
      if (operator === FieldOperator.Add) {
        await createNewField(field);
      }

      if (operator === FieldOperator.Insert) {
        await createNewField({
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
        table && fieldId && (await table.convertField(fieldId, field));
      }

      toast(
        operator === FieldOperator.Edit
          ? t('table:field.editor.fieldUpdated')
          : t('table:field.editor.fieldCreated')
      );
    } finally {
      setProcessVisible(false);
    }

    props.onConfirm?.();
  };

  const getPlan = async (fieldRo: IFieldRo) => {
    if (operator === FieldOperator.Edit) {
      return queryClient.ensureQueryData({
        queryKey: ReactQueryKeys.planFieldConvert(
          table?.id as string,
          props.field?.id as string,
          fieldRo
        ),
        queryFn: ({ queryKey }) =>
          planFieldConvert(queryKey[1], queryKey[2], queryKey[3]).then((data) => data.data),
      });
    }
    return queryClient.ensureQueryData({
      queryKey: ReactQueryKeys.planFieldCreate(table?.id as string, fieldRo),
      queryFn: ({ queryKey }) => planFieldCreate(queryKey[1], queryKey[2]),
    });
  };

  const onConfirm = async (fieldRo?: IFieldRo) => {
    if (!fieldRo) {
      return onCancel();
    }

    const plan = (await getPlan(fieldRo)) as IPlanFieldConvertVo;
    setFieldRo(fieldRo);
    setPlan(plan);
    if (plan && (plan.estimateTime || 0) > 1000) {
      setGraphVisible(true);
      return;
    }

    await performAction(fieldRo);
  };

  return (
    <>
      <FieldSettingBase {...props} onCancel={onCancel} onConfirm={onConfirm} />
      <ConfirmDialog
        contentClassName="max-w-4xl"
        title={t('table:field.editor.previewDependenciesGraph')}
        open={graphVisible}
        onOpenChange={setGraphVisible}
        content={
          <>
            <DynamicFieldGraph
              tableId={table?.id as string}
              fieldId={props.field?.id}
              fieldRo={fieldRo}
            />
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
    if (!updateCount) {
      onConfirm?.();
      return;
    }

    const result = convertFieldRoSchema.safeParse(field);
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
    toast.error(`Options Error`, {
      description: fromZodError(result.error).message,
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
        <SheetContent className="w-[328px] p-2" side="right">
          <div className="flex h-full flex-col gap-2">
            {/* Header */}
            <div className="text-md mx-2 w-full border-b py-2 font-semibold">{title}</div>
            {/* Content Form */}
            {
              <DynamicFieldEditor
                isPrimary={originField?.isPrimary}
                field={field}
                operator={operator}
                onChange={onFieldEditorChange}
              />
            }
            {/* Footer */}
            <div className="flex w-full shrink-0 justify-between p-2">
              <div>
                {showGraphButton && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size={'sm'} variant={'ghost'}>
                        <Share2 className="size-4" /> {t('table:field.editor.graph')}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl">
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
