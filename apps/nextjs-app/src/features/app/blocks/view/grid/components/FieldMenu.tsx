import { useField } from '@teable-group/sdk/hooks';
import classNames from 'classnames';
import { useRef } from 'react';
import { useClickAway } from 'react-use';
import { FieldMenu as FieldMenuComp } from '@/features/app/components/field-menu/FieldMenu';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { useGridViewStore } from '../store/gridView';

export const FieldMenu = () => {
  const { headerMenu, closeHeaderMenu, openSetting } = useGridViewStore();
  const visible = Boolean(headerMenu);
  const position = headerMenu?.pos;
  const style = position
    ? {
        left: position.x,
        top: position.y,
      }
    : {};

  const fieldId = headerMenu?.fieldId;
  const field = useField(fieldId);
  const fieldSettingRef = useRef<HTMLDivElement>(null);

  useClickAway(fieldSettingRef, () => {
    closeHeaderMenu();
  });

  const toOpenFieldSetting = () => {
    if (!fieldId) {
      return;
    }
    openSetting({
      fieldId,
      operator: FieldOperator.Edit,
    });
    closeHeaderMenu();
  };

  const deleteField = () => {
    closeHeaderMenu();
    field?.delete();
  };

  return (
    <div style={style} ref={fieldSettingRef} className="absolute">
      <div
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
