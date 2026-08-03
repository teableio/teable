import type { IFilterBaseComponent } from '../../../filter';
import { useCrud } from '../../../filter/hooks';
import { ContextColumnSelector } from '../../common/ContextColumnSelector';
import type { IBaseFilterItem } from './types';

export const FieldComponent: IFilterBaseComponent<IBaseFilterItem> = (props) => {
  const { path, value, item } = props;
  const { onChange } = useCrud();

  return (
    <div>
      <ContextColumnSelector
        value={value}
        onChange={(value, type) => {
          const parentPath = path.slice(0, -1);
          onChange(parentPath, {
            ...item,
            field: value,
            type,
          });
        }}
      />
    </div>
  );
};
