import { useField } from '@teable-group/sdk/hooks';
import type { IFieldInstance } from '@teable-group/sdk/model';
import classNames from 'classnames';
import { useEffect, useRef, useState } from 'react';
import { useClickAway, useToggle } from 'react-use';
import { FieldMenu as FieldMenuComp } from '@/features/app/components/field-menu/FieldMenu';
import { FieldSetting } from '@/features/app/components/field-setting/FieldSetting';

interface IFieldMenuProps {
  style?: React.CSSProperties;
  visible: boolean;
  fieldId?: string;
  onClose: () => void;
}

export const FieldMenu: React.FC<IFieldMenuProps> = (props) => {
  const { visible, fieldId, onClose, style } = props;

  const field = useField(fieldId);
  const [currentField, setCurrentField] = useState<IFieldInstance>();
  const fieldSettingRef = useRef<HTMLDivElement>(null);
  const [openFieldSetting, toggleOpenFieldSetting] = useToggle(false);

  useEffect(() => {
    if (visible) {
      setCurrentField(field);
    }
    if (!visible && !openFieldSetting) {
      setCurrentField(undefined);
    }
  }, [field, openFieldSetting, visible]);

  useClickAway(fieldSettingRef, () => {
    onClose();
  });

  const toOpenFieldSetting = () => {
    onClose();
    toggleOpenFieldSetting();
  };

  const onSettingConfirm = () => {
    onClose();
    toggleOpenFieldSetting();
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
      <FieldSetting
        visible={openFieldSetting}
        field={currentField}
        onCancel={() => toggleOpenFieldSetting()}
        onConfirm={onSettingConfirm}
      />
    </div>
  );
};
