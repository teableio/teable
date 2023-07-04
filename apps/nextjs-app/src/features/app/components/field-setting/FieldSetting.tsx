import type { IFieldRo } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { useTable } from '@teable-group/sdk/hooks';
import { Table } from '@teable-group/sdk/model';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Sheet, SheetContent } from '@teable-group/ui-lib/shadcn/ui/sheet';
import { useEffect, useRef, useState } from 'react';
import { FieldEditor } from './FieldEditor';
import type { IFieldSetting } from './type';
import { FieldOperator } from './type';

const defaultField = {
  name: '',
  type: FieldType.SingleLineText,
};

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
      const tableId = table?.id;
      const fieldId = props.field?.id;

      tableId &&
        fieldId &&
        Table.updateFieldById({
          ...field,
          id: fieldId,
          tableId,
        });
    }
  };

  return <FieldSettingBase {...props} onCancel={onCancel} onConfirm={onConfirm} />;
};

const FieldSettingBase = (props: IFieldSetting) => {
  const { visible, field: currentField, operator, onConfirm, onCancel } = props;
  const [currentVisible, setCurrentVisible] = useState<boolean | undefined>(visible);

  const fieldRef = useRef<IFieldRo>();
  const [updateCount, setUpdateCount] = useState<number>(0);

  useEffect(() => {
    setCurrentVisible(visible);
  }, [visible]);

  const onOpenChange = (open?: boolean) => {
    if (open) {
      return;
    }
    onCancel?.();
  };

  const onFieldEditorChange = (field: IFieldRo, updateCount?: number) => {
    updateCount != undefined && setUpdateCount(updateCount);
    fieldRef.current = field;
  };

  const onCancelInner = () => {
    if (updateCount > 0) {
      // confirm that update
    }
    setCurrentVisible(false);
    setUpdateCount(0);
  };

  const onConfirmInner = () => {
    setCurrentVisible(false);
    if (!fieldRef.current) {
      return;
    }
    onConfirm?.(fieldRef.current);
  };

  const title = operator === FieldOperator.Add ? 'Add Field' : 'Edit Field';

  const field = currentField
    ? {
        name: currentField.name,
        type: currentField.type,
        description: currentField.description,
        options: currentField.options,
      }
    : defaultField;

  return (
    <Sheet open={currentVisible} onOpenChange={onOpenChange}>
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
