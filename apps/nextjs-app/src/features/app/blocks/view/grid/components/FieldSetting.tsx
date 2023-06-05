import { useField } from '@teable-group/sdk';
import { FieldSetting as _FieldSetting } from '@/features/app/components/field-setting/FieldSetting';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { useGridViewStore } from '../store/gridView';

export const FieldSetting = () => {
  const { setting, closeSetting } = useGridViewStore();
  const field = useField(setting?.fieldId);
  const onCancel = () => {
    closeSetting();
  };
  const onConfirm = () => {
    closeSetting();
  };

  const visible = Boolean(setting);
  if (!visible) {
    return <></>;
  }

  return (
    <_FieldSetting
      visible={visible}
      field={field}
      operator={setting?.operator || FieldOperator.Add}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
};
