import { difference, map } from 'lodash';
import React from 'react';
import { useTranslation } from '../../context/app/i18n';

import { useViewId, useFields, useView } from '../../hooks';
import type { GridView, IFieldInstance } from '../../model';
import { HideFieldsBase } from './HideFieldsBase';

export const HideFields: React.FC<{
  footer?: React.ReactNode;
  children: (text: string, isActive: boolean) => React.ReactNode;
}> = ({ footer, children }) => {
  const activeViewId = useViewId();
  const fields = useFields({ withHidden: true, withDenied: true });
  const view = useView() as GridView | undefined;
  const { t } = useTranslation();

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
        view.updateColumnMeta(
          hiddenIds.map((id) => ({ fieldId: id, columnMeta: { hidden: true } }))
        );

      showIds.length &&
        view.updateColumnMeta(
          showIds.map((id) => ({ fieldId: id, columnMeta: { hidden: false } }))
        );
    }
  };

  if (!activeViewId) {
    return <></>;
  }

  return (
    <HideFieldsBase footer={footer} fields={fieldData} hidden={hiddenFieldIds} onChange={onChange}>
      {children(
        hiddenCount ? t('hidden.configLabel_other', { count: hiddenCount }) : t('hidden.label'),
        Boolean(hiddenCount)
      )}
    </HideFieldsBase>
  );
};
