import { difference } from 'lodash';
import React, { useMemo } from 'react';
import { useViewId, useFields, useView } from '../../hooks';
import type { KanbanView } from '../../model';
import { HideFieldsBase } from './HideFieldsBase';

export const VisibleFields: React.FC<{
  footer?: React.ReactNode;
  children: (text: string, isActive: boolean) => React.ReactNode;
}> = ({ footer, children }) => {
  const activeViewId = useViewId();
  const totalFields = useFields({ withHidden: true, withDenied: true });
  const view = useView() as KanbanView | undefined;
  const columnMeta = view?.columnMeta;

  const hiddenFieldIds = useMemo(
    () =>
      totalFields
        .filter(({ id, isPrimary }) => !isPrimary && !columnMeta?.[id]?.visible)
        .map(({ id }) => id),
    [totalFields, columnMeta]
  );
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
          hiddenIds.map((id) => ({ fieldId: id, columnMeta: { visible: false } }))
        );

      showIds.length &&
        view.updateColumnMeta(
          showIds.map((id) => ({ fieldId: id, columnMeta: { visible: true } }))
        );
    }
  };

  if (!activeViewId) {
    return null;
  }

  return (
    <HideFieldsBase
      footer={footer}
      fields={totalFields}
      hidden={hiddenFieldIds}
      onChange={onChange}
    >
      {children(
        hiddenCount ? `${hiddenCount} hidden field(s)` : 'Hide fields',
        Boolean(hiddenCount)
      )}
    </HideFieldsBase>
  );
};
