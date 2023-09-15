import type { IFieldOptionsRo, IFieldRo } from '@teable-group/core';
import { getOptionsSchema, updateFieldRoSchema, FieldType } from '@teable-group/core';
import { useTable } from '@teable-group/sdk/hooks';
import { useToast } from '@teable-group/ui-lib/shadcn';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Sheet, SheetContent } from '@teable-group/ui-lib/shadcn/ui/sheet';
import { useCallback, useState } from 'react';
import { fromZodError } from 'zod-validation-error';
import { FieldEditor } from './FieldEditor';
import type { IFieldSetting } from './type';
import { FieldOperator } from './type';

export const FieldSetting = (props: IFieldSetting) => {
  const table = useTable();

  const { operator } = props;
  const onCancel = () => {
    props.onCancel?.();
  };

  const onConfirm = async (field: IFieldRo) => {
    if (operator === FieldOperator.Add) {
      await table?.createField(field);
    }

    if (operator === FieldOperator.Edit) {
      const fieldId = props.field?.id;
      table && fieldId && (await table.updateField(fieldId, field));
    }

    props.onConfirm?.(field);
  };

  return <FieldSettingBase {...props} onCancel={onCancel} onConfirm={onConfirm} />;
};

const getOriginOptions = (type?: FieldType, options?: IFieldOptionsRo) => {
  if (!type) {
    return {};
  }

  const schema = getOptionsSchema(type);
  const result = schema && schema.strip().safeParse(options);

  if (!result || !result.success) {
    return {};
  }

  return result.data;
};

const FieldSettingBase = (props: IFieldSetting) => {
  const { visible, field: originField, operator, onConfirm, onCancel } = props;
  const { toast } = useToast();
  const [field, setField] = useState<IFieldRo>({
    name: originField?.name,
    type: originField?.type || FieldType.SingleLineText,
    description: originField?.description,
    options: getOriginOptions(originField?.type, originField?.options),
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

  const onFieldEditorChange = useCallback((field: IFieldRo) => {
    setField(field);
    setUpdateCount(1);
  }, []);

  const onCancelInner = () => {
    const prompt = 'Are you sure you want to discard your changes?';
    if (updateCount > 0 && !window.confirm(prompt)) {
      return;
    }
    onCancel?.();
  };

  const onConfirmInner = () => {
    const result = updateFieldRoSchema.safeParse(field);
    if (result.success) {
      console.log('confirmField', result.data);
      return onConfirm?.(result.data);
    }

    toast({
      title: 'Options Error',
      variant: 'destructive',
      description: fromZodError(result.error).message,
    });
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
