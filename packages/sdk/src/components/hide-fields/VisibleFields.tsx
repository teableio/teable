import { difference } from 'lodash';
import React, { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useViewId, useFields, useView } from '../../hooks';
import type { KanbanView } from '../../model';
import { swapReorder } from '../../utils';
import { HideFieldsBase } from './HideFieldsBase';

export const VisibleFields: React.FC<{
  footer?: React.ReactNode;
  responsive?: boolean;
  title?: string;
  children: (text: string, isActive: boolean) => React.ReactNode;
}> = ({ footer, responsive, title, children }) => {
  const { t } = useTranslation();
  const activeViewId = useViewId();
  const totalFields = useFields({ withHidden: true, withDenied: true });
  const view = useView() as KanbanView | undefined;
  const columnMeta = view?.columnMeta;

  const hiddenFieldIds = useMemo(
    () =>
      totalFields
        .filter(
          ({ id, isPrimary }) =>
            !isPrimary &&
            !(columnMeta?.[id]?.visible === undefined ? true : columnMeta?.[id]?.visible)
        )
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

  const onOrderChange = (fieldId: string, fromIndex: number, toIndex: number) => {
    if (!view) return;

    const newOrder = swapReorder(1, fromIndex, toIndex, totalFields.length, (index) => {
      const fieldId = totalFields[index].id;
      return view?.columnMeta[fieldId].order;
    })[0];

    if (newOrder === view?.columnMeta[fieldId].order) {
      return;
    }

    view.updateColumnMeta([
      {
        fieldId,
        columnMeta: {
          order: newOrder,
        },
      },
    ]);
  };

  if (!activeViewId) {
    return null;
  }

  return (
    <HideFieldsBase
      responsive={responsive}
      title={title}
      footer={footer}
      fields={totalFields}
      hidden={hiddenFieldIds}
      onChange={onChange}
      onOrderChange={onOrderChange}
    >
      {children(
        hiddenCount ? t('hidden.configLabel_other', { count: hiddenCount }) : t('hidden.label'),
        Boolean(hiddenCount)
      )}
    </HideFieldsBase>
  );
};
