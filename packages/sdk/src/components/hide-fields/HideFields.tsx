import { difference, map } from 'lodash';
import React from 'react';
import { useViewId, useFields, useTableId, useView } from '../../hooks';
import { View } from '../../model';
import type { IFieldInstance } from '../../model';
import { HideFieldsBase } from './HideFieldsBase';

export const HideFields: React.FC<{
  children: (text: string, isActive: boolean) => React.ReactNode;
}> = ({ children }) => {
  const activeViewId = useViewId();
  const fields = useFields({ withHidden: true });
  const tableId = useTableId();
  const viewId = useViewId();
  const view = useView();

  const filterFields = (fields: IFieldInstance[], shouldBeHidden?: boolean) =>
    fields.filter(
      ({ isPrimary, id }) =>
        activeViewId &&
        !isPrimary &&
        (!shouldBeHidden || view?.columnMeta?.[id]?.hidden === shouldBeHidden)
    );

  const fieldData = filterFields(fields);
  const hiddenFieldIds = map(filterFields(fields, true), 'id');
  const hiddenCount = hiddenFieldIds.length;

  const onChange = (hidden: string[]) => {
    if (!activeViewId) {
      return;
    }
    const hiddenIds = difference(hidden, hiddenFieldIds);
    const showIds = difference(hiddenFieldIds, hidden);

    if (tableId && viewId) {
      hiddenIds.length &&
        View.setViewColumnMeta(
          tableId,
          viewId,
          hiddenIds.map((id) => ({ fieldId: id, columnMeta: { hidden: true } }))
        );

      showIds.length &&
        View.setViewColumnMeta(
          tableId,
          viewId,
          showIds.map((id) => ({ fieldId: id, columnMeta: { hidden: false } }))
        );
    }
  };

  if (!activeViewId) {
    return <></>;
  }

  return (
    <HideFieldsBase fields={fieldData} hidden={hiddenFieldIds} onChange={onChange}>
      {children(
        hiddenCount ? `${hiddenCount} hidden field(s)` : 'Hide fields',
        Boolean(hiddenCount)
      )}
    </HideFieldsBase>
  );
};
