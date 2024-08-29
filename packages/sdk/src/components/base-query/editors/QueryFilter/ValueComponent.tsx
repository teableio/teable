import { BaseQueryColumnType } from '@teable/openapi';
import { useTranslation } from '../../../../context/app/i18n';
import { createFieldInstance } from '../../../../model';
import { NumberEditor } from '../../../editor';
import type { IFilterBaseComponent } from '../../../filter';
import { BaseFieldValue } from '../../../filter';
import { useCrud } from '../../../filter/hooks';
import { useAllColumns } from '../../common/useAllColumns';
import type { IBaseFilterItem } from './types';

export const ValueComponent: IFilterBaseComponent<IBaseFilterItem> = (props) => {
  const { path, value, item } = props;
  const { onChange } = useCrud();
  const columns = useAllColumns();
  const { t } = useTranslation();

  const field = columns.find((column) => column.column === item.field)?.fieldSource;
  if (field && item.type === BaseQueryColumnType.Field && item.field) {
    return (
      <BaseFieldValue
        value={value}
        onSelect={(value) => {
          onChange(path, value);
        }}
        operator={item.operator}
        field={createFieldInstance(field)}
      />
    );
  }
  if (item.type === BaseQueryColumnType.Aggregation) {
    return (
      <NumberEditor
        value={value as number}
        onChange={(value?: number | null) => onChange(path, value)}
        className="min-w-28 max-w-40 placeholder:text-xs"
        placeholder={t('filter.default.placeholder')}
      />
    );
  }
};
