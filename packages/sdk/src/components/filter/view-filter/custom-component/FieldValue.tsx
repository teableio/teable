import type { IFilterItem } from '@teable/core';
import { CellValueType } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import { useInDrawer } from '../../../adaptive-panel';
import { useCrud } from '../../hooks';
import type { IFilterComponents } from '../../index';
import type { IBaseFilterCustomComponentProps, IConditionItemProperty } from '../../types';
import { useViewFilterContext } from '../hooks';
import { useFields } from '../hooks/useFields';
import { useFilterModal } from '../hooks/useFilterModal';
import type { IViewFilterConditionItem } from '../types';
import { BaseFieldValue } from './BaseFieldValue';
import type { IFilterReferenceSource } from './BaseFieldValue';

interface IFieldValue<T extends IConditionItemProperty = IViewFilterConditionItem>
  extends IBaseFilterCustomComponentProps<T, T['value']> {
  components?: IFilterComponents;
  referenceSource?: IFilterReferenceSource;
}

export const FieldValue = <T extends IConditionItemProperty = IViewFilterConditionItem>(
  props: IFieldValue<T>
) => {
  const ctxModal = useFilterModal();
  const inDrawer = useInDrawer();
  const { path, components, value, item, modal = ctxModal, referenceSource } = props;
  const fields = useFields();
  const { onChange } = useCrud();
  const linkContext = useViewFilterContext();
  const field = fields.find((f) => f.id === item.field);

  const defaultReferenceSource = useMemo<IFilterReferenceSource | undefined>(() => {
    if (!referenceSource) {
      return undefined;
    }
    if (referenceSource.tableId) {
      return referenceSource;
    }
    const fallbackTableId = referenceSource.fields[0]?.tableId ?? field?.tableId;
    if (!fallbackTableId) {
      return referenceSource;
    }
    return {
      ...referenceSource,
      tableId: fallbackTableId,
    };
  }, [field?.tableId, referenceSource]);

  const editor = (
    <BaseFieldValue
      value={value}
      field={field}
      modal={modal}
      components={components}
      operator={item.operator as IFilterItem['operator']}
      onSelect={(newValue) => {
        if (newValue === '' || (Array.isArray(newValue) && !newValue.length)) {
          onChange(path, null);
          return;
        }
        onChange(path, newValue);
      }}
      linkContext={linkContext}
      referenceSource={defaultReferenceSource}
    />
  );

  if (!inDrawer) return editor;

  // Fill the remaining row width without shrinking below the editor minimum.
  // Date values wrap as one unit so their mode and input stay side by side.
  // `empty:hidden` collapses valueless operators such as "is empty".
  return (
    <div
      className={cn(
        'min-w-[120px] flex-1 empty:hidden',
        field?.cellValueType === CellValueType.DateTime && 'w-full flex-none'
      )}
    >
      {editor}
    </div>
  );
};
