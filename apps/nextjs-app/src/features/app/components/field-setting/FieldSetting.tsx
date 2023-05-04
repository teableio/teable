import type { IFieldInstance } from '@teable-group/sdk/model';
import { useState } from 'react';
import { Drawer } from './Drawer';
import type { IFieldSetting } from './FieldEditor';
import { FieldEditor } from './FieldEditor';

export const FieldSetting = (props: {
  visible?: boolean;
  field?: IFieldInstance;
  onConfirm?: (field: IFieldSetting) => void;
  onCancel?: () => void;
}) => {
  const { visible, field: currentField, onConfirm, onCancel } = props;

  const [field, setField] = useState<IFieldSetting>();
  const [updateCount, setUpdateCount] = useState<number>(0);

  const onFieldEditorChange = (field: IFieldSetting, updateCount?: number) => {
    updateCount != undefined && setUpdateCount(updateCount);
    setField(field);
  };

  const clickCancel = () => {
    if (updateCount > 0) {
      // confirm that update
    }
    onCancel?.();
    setUpdateCount(0);
  };

  const clickConfirm = () => {
    if (!field) {
      onCancel?.();
      return;
    }
    onConfirm?.(field);
  };

  return (
    <Drawer visible={visible} onChange={clickCancel}>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="w-full p-4 border-b border-base-content/10">Field Edit</div>
        {/* Content Form */}
        {currentField && <FieldEditor field={currentField} onChange={onFieldEditorChange} />}
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
