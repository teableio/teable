import { difference, map } from 'lodash';
import React from 'react';
import { useViewId, useFields } from '../../hooks';
import type { IFieldInstance } from '../../model';
import { HideFieldsBase } from './HideFieldsBase';

export const HideFields: React.FC<{
  children: (text: string, isActive: boolean) => React.ReactNode;
}> = ({ children }) => {
  const activeViewId = useViewId();
  const fields = useFields({ withHidden: true });

  const filterFields = (fields: IFieldInstance[], shouldBeHidden?: boolean) =>
    fields.filter(
      (field) =>
        activeViewId &&
        !field.isPrimary &&
        (!shouldBeHidden || field.columnMeta[activeViewId]?.hidden === shouldBeHidden)
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
    hiddenIds.forEach(
      (id) => fieldData.find((field) => field.id === id)?.updateColumnHidden(activeViewId, true)
    );
    showIds.forEach(
      (id) => fieldData.find((field) => field.id === id)?.updateColumnHidden(activeViewId, false)
    );
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
