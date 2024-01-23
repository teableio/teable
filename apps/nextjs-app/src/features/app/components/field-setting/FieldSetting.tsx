import { useQueryClient } from '@tanstack/react-query';
import type { IFieldRo } from '@teable-group/core';
import { updateFieldRoSchema, FieldType, getOptionsSchema } from '@teable-group/core';
import { Share2 } from '@teable-group/icons';
import { planFieldCreate, type IPlanFieldUpdateVo, planFieldUpdate } from '@teable-group/openapi';
import { ReactQueryKeys } from '@teable-group/sdk/config';
import { useTable, useView } from '@teable-group/sdk/hooks';
import { ConfirmDialog } from '@teable-group/ui-lib/base';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from '@teable-group/ui-lib/shadcn';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Sheet, SheetContent } from '@teable-group/ui-lib/shadcn/ui/sheet';
import { toast } from '@teable-group/ui-lib/shadcn/ui/sonner';
import { useCallback, useMemo, useState } from 'react';
import { fromZodError } from 'zod-validation-error';
import { DynamicFieldGraph } from '../../blocks/graph/DynamicFieldGraph';
import { ProgressBar } from '../../blocks/graph/ProgressBar';
import { DynamicFieldEditor } from './DynamicFieldEditor';
import type { IFieldEditorRo, IFieldSetting, IFieldSettingBase } from './type';
import { FieldOperator } from './type';

export const FieldSetting = (props: IFieldSetting) => {
  const { operator, order } = props;

  const table = useTable();
  const view = useView();

  const [graphVisible, setGraphVisible] = useState<boolean>(false);
  const [processVisible, setProcessVisible] = useState<boolean>(false);
  const [plan, setPlan] = useState<IPlanFieldUpdateVo>();
  const [fieldRo, setFieldRo] = useState<IFieldRo>();
  const queryClient = useQueryClient();

  const onCancel = () => {
    props.onCancel?.();
  };

  const performAction = async (field: IFieldRo) => {
    setGraphVisible(false);
    if (plan && (plan.estimateTime || 0) > 1000) {
      setProcessVisible(true);
    }
    try {
      if (operator === FieldOperator.Add) {
        await table?.createField(field);
      }

      if (operator === FieldOperator.Insert) {
        const result = await table?.createField(field);
        const fieldId = result?.data?.id;
        if (view && order != null && fieldId && table?.id) {
          await view.updateColumnMeta([{ fieldId, columnMeta: { order } }]);
        }
      }

      if (operator === FieldOperator.Edit) {
        const fieldId = props.field?.id;
        table && fieldId && (await table.updateField(fieldId, field));
      }

      toast(`Field has been ${operator === FieldOperator.Edit ? 'updated' : 'created'}`, {
        action: {
          label: 'Dismiss',
          onClick: () => {
            toast.dismiss();
          },
        },
      });
    } finally {
      setProcessVisible(false);
    }

    props.onConfirm?.();
  };

  const getPlan = async (fieldRo: IFieldRo) => {
    if (operator === FieldOperator.Edit) {
      return queryClient.ensureQueryData({
        queryKey: ReactQueryKeys.planFieldUpdate(
          table?.id as string,
          props.field?.id as string,
          fieldRo
        ),
        queryFn: ({ queryKey }) => planFieldUpdate(queryKey[1], queryKey[2], queryKey[3]),
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

    const plan = (await getPlan(fieldRo)).data;
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
        title="Preview Dependencies Graph"
        open={graphVisible}
        onOpenChange={setGraphVisible}
        content={
          <>
            <DynamicFieldGraph
              tableId={table?.id as string}
              fieldId={props.field?.id}
              fieldRo={fieldRo}
            />
            <p className="text-sm">Are you sure you want to perform it?</p>
          </>
        }
        cancelText="Cancel"
        confirmText="Continue"
        onCancel={() => setGraphVisible(false)}
        onConfirm={() => performAction(fieldRo as IFieldRo)}
      />
      <ConfirmDialog
        open={processVisible}
        onOpenChange={setProcessVisible}
        title="Calculating..."
        content={
          <ProgressBar duration={plan?.estimateTime || 0} cellCount={plan?.updateCellCount || 0} />
        }
      />
    </>
  );
};

const FieldSettingBase = (props: IFieldSettingBase) => {
  const { visible, field: originField, operator, onConfirm, onCancel } = props;
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
      const result = updateFieldRoSchema.safeParse(field);
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

  const onSave = () => {
    !updateCount && onConfirm?.();
    const result = updateFieldRoSchema.safeParse(field);
    if (result.success) {
      onConfirm?.(result.data);
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
        return 'Add Field';
      case FieldOperator.Edit:
        return 'Edit Field';
      case FieldOperator.Insert:
        return 'Insert Field';
    }
  }, [operator]);

  return (
    <>
      <Sheet open={visible} onOpenChange={onOpenChange}>
        <SheetContent className="w-[320px] p-2" side="right">
          <div className="flex h-full flex-col gap-2">
            {/* Header */}
            <div className="text-md mx-2 w-full border-b py-2 font-semibold">{title}</div>
            {/* Content Form */}
            {<DynamicFieldEditor field={field} onChange={onFieldEditorChange} />}
            {/* Footer */}
            <div className="flex w-full justify-between p-2">
              <div>
                {showGraphButton && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size={'sm'} variant={'ghost'}>
                        <Share2 className="size-4" /> Graph
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
                            Close
                          </Button>
                        </DialogClose>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <div className="flex gap-2">
                <Button size={'sm'} variant={'ghost'} onClick={onCancelInner}>
                  Cancel
                </Button>
                <Button size={'sm'} onClick={onSave}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={alertVisible}
        onOpenChange={setAlertVisible}
        title="Are you sure you want to discard your changes?"
        onCancel={() => setAlertVisible(false)}
        cancelText="Cancel"
        confirmText="Continue"
        onConfirm={onCancel}
      />
    </>
  );
};
