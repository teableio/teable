import type { IFieldRo } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { useTable } from '@teable-group/sdk/hooks';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Sheet, SheetContent } from '@teable-group/ui-lib/shadcn/ui/sheet';
import { useState } from 'react';
import { FieldEditor } from './FieldEditor';
import type { IFieldSetting } from './type';
import { FieldOperator } from './type';

export const FieldSetting = (props: IFieldSetting) => {
  const table = useTable();
  const { operator } = props;
  const onCancel = () => {
    props.onCancel?.();
  };

  const onConfirm = (field: IFieldRo) => {
    props.onConfirm?.(field);

    if (operator === FieldOperator.Add) {
      table?.createField(field);
      return;
    }

    if (operator === FieldOperator.Edit) {
      const fieldId = props.field?.id;

      table && fieldId && table.updateField(fieldId, field);
    }
  };

  return <FieldSettingBase {...props} onCancel={onCancel} onConfirm={onConfirm} />;
};

const FieldSettingBase = (props: IFieldSetting) => {
  const { visible, field: originField, operator, onConfirm, onCancel } = props;
  const [field, setField] = useState<IFieldRo>({
    name: originField?.name,
    type: originField?.type || FieldType.SingleLineText,
    description: originField?.description,
    options: originField?.options,
    isLookup: originField?.isLookup,
    lookupOptions: originField?.lookupOptions,
  });

  const [updateCount, setUpdateCount] = useState<number>(0);

  const onOpenChange = (open?: boolean) => {
    if (open) {
      return;
    }
    onCancel?.();
  };

  const onFieldEditorChange = (field: IFieldRo) => {
    setField(field);
    setUpdateCount(1);
  };

  const onCancelInner = () => {
    const prompt = 'Are you sure you want to discard your changes?';
    if (updateCount > 0 && !window.confirm(prompt)) {
      return;
    }
    onCancel?.();
  };

  const onConfirmInner = () => {
    onConfirm?.(field);
  };

  const title = operator === FieldOperator.Add ? 'Add Field' : 'Edit Field';

  return (
    <Sheet open={visible} onOpenChange={onOpenChange}>
      <SheetContent className="p-2 w-[320px]" side="right">
        <div className="h-full flex flex-col gap-2">
          {/* Header */}
          <div className="text-md w-full mx-2 py-2 font-semibold border-b">{title}</div>
          {/* Content Form */}
          {<FieldEditor field={field} onChange={onFieldEditorChange} />}
          {/* Footer */}
          <div className="flex w-full justify-end space-x-2 p-2">
            <Button size={'sm'} variant={'ghost'} onClick={onCancelInner}>
              Cancel
            </Button>
            <Button size={'sm'} onClick={onConfirmInner}>
              Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
