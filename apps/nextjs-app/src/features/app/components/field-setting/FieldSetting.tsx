import type { IFieldRo } from '@teable-group/core';
import { updateFieldRoSchema, FieldType, getOptionsSchema } from '@teable-group/core';
import { Share2 } from '@teable-group/icons';
import { useTable, useView } from '@teable-group/sdk/hooks';
import { ConfirmDialog } from '@teable-group/ui-lib/base';
import { useToast } from '@teable-group/ui-lib/shadcn';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Sheet, SheetContent } from '@teable-group/ui-lib/shadcn/ui/sheet';
import { useCallback, useMemo, useState } from 'react';
import { fromZodError } from 'zod-validation-error';
import { DynamicFieldGraph } from '../../blocks/graph/DynamicFieldGraph';
import { DynamicFieldEditor } from './DynamicFieldEditor';
import type { IFieldEditorRo, IFieldSetting } from './type';
import { FieldOperator } from './type';

export const FieldSetting = (props: IFieldSetting) => {
  const table = useTable();
  const view = useView();

  const { operator, order } = props;
  const onCancel = () => {
    props.onCancel?.();
  };

  const onConfirm = async (field: IFieldRo) => {
    if (operator === FieldOperator.Add) {
      await table?.createField(field);
    }

    if (operator === FieldOperator.Insert) {
      const result = await table?.createField(field);
      const fieldId = result?.data?.id;
      if (view && order != null && fieldId && table?.id) {
        await view.setViewColumnMeta([{ fieldId, columnMeta: { order } }]);
      }
    }

    if (operator === FieldOperator.Edit) {
      const fieldId = props.field?.id;
      table && fieldId && (await table.updateField(fieldId, field));
    }

    props.onConfirm?.(field);
  };

  return <FieldSettingBase {...props} onCancel={onCancel} onConfirm={onConfirm} />;
};

const FieldSettingBase = (props: IFieldSetting) => {
  const { visible, field: originField, operator, onConfirm, onCancel } = props;
  const table = useTable();
  const { toast } = useToast();
  const [field, setField] = useState<IFieldEditorRo>(
    originField
      ? { ...originField, options: getOptionsSchema(originField.type).parse(originField.options) }
      : {
          type: FieldType.SingleLineText,
        }
  );
  const [alertVisible, setAlertVisible] = useState<boolean>(false);
  const [graphVisible, setGraphVisible] = useState<boolean>(false);
  const [updateCount, setUpdateCount] = useState<number>(0);
  const [showGraphButton, setShowGraphButton] = useState<boolean>(true);

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
    const result = updateFieldRoSchema.safeParse(field);
    if (result.success) {
      if (isCreatingSimpleField(result.data)) {
        onConfirm?.(result.data);
      } else {
        setGraphVisible(true);
      }
      return;
    }
    console.error('fieldConFirm', field);
    console.error('fieldConFirmResult', fromZodError(result.error).message);
    toast({
      title: 'Options Error',
      variant: 'destructive',
      description: fromZodError(result.error).message,
    });
  };

  const onConfirmInner = () => {
    const result = updateFieldRoSchema.safeParse(field);
    if (result.success) {
      onConfirm?.(result.data);
    }
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
            <div className="flex flex-1 flex-col gap-4">
              {<DynamicFieldEditor field={field} onChange={onFieldEditorChange} />}
              {showGraphButton && (
                <div>
                  <Button
                    className="w-full"
                    size={'sm'}
                    variant={'ghost'}
                    onClick={() => setGraphVisible(true)}
                  >
                    <Share2 className="h-4 w-4" /> show dependencies graph
                  </Button>
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="flex w-full justify-end space-x-2 p-2">
              <Button size={'sm'} variant={'ghost'} onClick={onCancelInner}>
                Cancel
              </Button>
              <Button size={'sm'} onClick={onSave}>
                Save
              </Button>
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
      <ConfirmDialog
        contentClassName="max-w-6xl"
        title="Field Dependencies Graph"
        open={graphVisible}
        onOpenChange={setGraphVisible}
        content={
          <DynamicFieldGraph
            tableId={table?.id as string}
            fieldId={props.field?.id}
            fieldRo={updateCount ? (field as IFieldRo) : undefined}
          />
        }
        cancelText="Cancel"
        confirmText="Continue"
        onCancel={() => setGraphVisible(false)}
        onConfirm={onConfirmInner}
      />
    </>
  );
};
