import type { IFieldRo } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { useTable } from '@teable-group/sdk/hooks';
import { Table } from '@teable-group/sdk/model';
import { Button, Drawer } from 'antd';
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
  const [currentOperator, setCurrentOperator] = useState<'cancel' | 'confirm'>();

  const fieldRef = useRef<IFieldRo>();
  const [updateCount, setUpdateCount] = useState<number>(0);

  useEffect(() => {
    setCurrentVisible(visible);
  }, [visible]);

  const onEditFinished = (open?: boolean) => {
    if (open) {
      return;
    }
    if (fieldRef.current && currentOperator === 'confirm') {
      onConfirm?.(fieldRef.current);
      return;
    }
    onCancel?.();
  };

  const onFieldEditorChange = (field: IFieldRo, updateCount?: number) => {
    updateCount != undefined && setUpdateCount(updateCount);
    fieldRef.current = field;
  };

  const clickCancel = () => {
    if (updateCount > 0) {
      // confirm that update
    }
    setCurrentOperator('cancel');
    setCurrentVisible(false);
    setUpdateCount(0);
  };

  const clickConfirm = () => {
    setCurrentVisible(false);
    if (!fieldRef.current) {
      return;
    }
    setCurrentOperator('confirm');
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
    <Drawer
      bodyStyle={{ padding: 0 }}
      closable={false}
      open={currentVisible}
      onClose={clickCancel}
      afterOpenChange={onEditFinished}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="w-full p-4 border-b border-base-content/10">{title}</div>
        {/* Content Form */}
        {<FieldEditor field={field} onChange={onFieldEditorChange} />}
        {/* Footer */}
        <div className="flex w-full justify-end space-x-3 border-t border-base-content/10 px-3 py-4">
          <Button onClick={clickCancel}>Cancel</Button>
          <Button type={'primary'} onClick={clickConfirm}>
            Save
          </Button>
        </div>
      </div>
    </Drawer>
  );
};
