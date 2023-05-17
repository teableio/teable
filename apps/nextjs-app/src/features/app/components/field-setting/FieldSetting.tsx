import type { IFieldRo } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { useTable } from '@teable-group/sdk/hooks';
import { Table } from '@teable-group/sdk/model';
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Drawer } from './Drawer';
import { FieldEditor } from './FieldEditor';
import { useFieldSettingStore } from './store';
import type { IFieldSetting } from './type';
import { FieldOperator } from './type';

export const expandFieldSetting = (props: IFieldSetting) => {
  const { onCancel, onConfirm } = props;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onModalClose = () => {
    root.unmount();
    container.parentElement?.removeChild(container);
    onCancel?.();
  };
  const confirm = (field: IFieldRo) => {
    onConfirm?.(field);
    onModalClose();
  };
  root.render(<FieldSetting {...props} onConfirm={confirm} onCancel={onModalClose} visible />);
};

const defaultField = {
  name: '',
  type: FieldType.SingleLineText,
};

export const FieldSettingStorage = () => {
  const { fieldSetting, close } = useFieldSettingStore();
  const table = useTable();
  const onCancel = () => {
    close();
  };
  const onConfirm = (field: IFieldRo) => {
    close();
    if (fieldSetting.operator === FieldOperator.Add) {
      table?.createField(field);
      return;
    }

    if (fieldSetting.operator === FieldOperator.Edit) {
      const tableId = table?.id;
      const fieldId = fieldSetting.field?.id;

      tableId &&
        fieldId &&
        Table.updateFieldById({
          ...field,
          id: fieldId,
          tableId,
        });
    }
  };

  return <FieldSetting {...fieldSetting} onCancel={onCancel} onConfirm={onConfirm} />;
};

export const FieldSetting = (props: IFieldSetting) => {
  const { visible, field: currentField, operator = FieldOperator.Add, onConfirm, onCancel } = props;

  const fieldRef = useRef<IFieldRo>();
  const [updateCount, setUpdateCount] = useState<number>(0);

  const onFieldEditorChange = (field: IFieldRo, updateCount?: number) => {
    updateCount != undefined && setUpdateCount(updateCount);
    fieldRef.current = field;
  };

  const clickCancel = () => {
    if (updateCount > 0) {
      // confirm that update
    }
    onCancel?.();
    setUpdateCount(0);
  };

  const clickConfirm = () => {
    if (!fieldRef.current) {
      onCancel?.();
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
    <Drawer visible={visible} onChange={clickCancel}>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="w-full p-4 border-b border-base-content/10">{title}</div>
        {/* Content Form */}
        {visible && <FieldEditor field={field} onChange={onFieldEditorChange} />}
        {/* Footer */}
        <div className="flex w-full justify-end space-x-3 border-t border-base-content/10 px-3 py-4">
          <button className="btn btn-outline btn-sm" onClick={clickCancel}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={clickConfirm}>
            Save
          </button>
        </div>
      </div>
    </Drawer>
  );
};
