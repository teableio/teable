import { useField } from '@teable-group/sdk/hooks';
import classNames from 'classnames';
import { useRef } from 'react';
import { useClickAway } from 'react-use';
import { FieldMenu as FieldMenuComp } from '@/features/app/components/field-menu/FieldMenu';
import { useFieldSettingStore } from '@/features/app/components/field-setting/store';
import { FieldOperator } from '@/features/app/components/field-setting/type';

interface IFieldMenuProps {
  style?: React.CSSProperties;
  visible: boolean;
  fieldId?: string;
  onClose: () => void;
}

export const FieldMenu: React.FC<IFieldMenuProps> = (props) => {
  const { visible, fieldId, onClose, style } = props;

  const field = useField(fieldId);
  const fieldSettingRef = useRef<HTMLDivElement>(null);
  const fieldSettingStore = useFieldSettingStore();

  useClickAway(fieldSettingRef, () => {
    onClose();
  });

  const toOpenFieldSetting = () => {
    if (!field) {
      return;
    }
    fieldSettingStore.open({
      field,
      operator: FieldOperator.Edit,
    });
    onClose();
  };

  const deleteField = () => {
    onClose();
    field?.delete();
  };

  return (
    <div style={style} ref={fieldSettingRef} className="absolute">
      <div
        style={style}
        className={classNames({
          hidden: !visible,
        })}
      >
        <FieldMenuComp
          operations={{
            openFieldSetting: toOpenFieldSetting,
            deleteField,
          }}
        />
      </div>
    </div>
  );
};
