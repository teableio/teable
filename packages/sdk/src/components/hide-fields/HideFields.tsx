import { difference, map } from 'lodash';
import React from 'react';
import { useViewId, useFields, useView } from '../../hooks';
import type { IFieldInstance } from '../../model';
import { HideFieldsBase } from './HideFieldsBase';

export const HideFields: React.FC<{
  children: (text: string, isActive: boolean) => React.ReactNode;
}> = ({ children }) => {
  const activeViewId = useViewId();
  const fields = useFields({ withHidden: true });
  const view = useView();

  const filterFields = (fields: IFieldInstance[], shouldBeHidden?: boolean) =>
    fields.filter(
      ({ id }) =>
        activeViewId && (!shouldBeHidden || view?.columnMeta?.[id]?.hidden === shouldBeHidden)
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

    if (view) {
      hiddenIds.length &&
        view.setViewColumnMeta(
          hiddenIds.map((id) => ({ fieldId: id, columnMeta: { hidden: true } }))
        );

      showIds.length &&
        view.setViewColumnMeta(
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
