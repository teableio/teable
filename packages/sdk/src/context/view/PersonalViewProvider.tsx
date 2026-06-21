import type { IFieldVo, IGridColumnMeta, ISort, ITableActionKey, IViewVo } from '@teable/core';
import type { IGetRecordsRo, IAggregationRo } from '@teable/openapi';
import { useCallback, useMemo } from 'react';
import { useFields, useTableId, useTableListener, useView } from '../../hooks';
import { validatePersonalViewProps } from '../../utils/personalView';
import { buildStatisticFieldMap } from '../../utils/statistic';
import { PersonalViewContext } from './PersonalViewContext';
import { useResolvedPersonalViewStore } from './store';

interface IPersonalViewProviderProps {
  children: React.ReactNode;
}

export const PersonalViewProvider = ({ children }: IPersonalViewProviderProps) => {
  const view = useView();
  const tableId = useTableId();
  const visibleFields = useFields();
  const fields = useFields({ withHidden: true, withDenied: true });
  const { personalViewMap, setPersonalViewMap } = useResolvedPersonalViewStore();

  const viewId = view?.id ?? '';
  const cachedView = personalViewMap?.[viewId];
  const isPersonalView = Boolean(cachedView);
  const visibleFieldIds = visibleFields.map(({ id }) => id);

  const { personalViewCommonQuery, personalViewAggregationQuery } = useMemo(() => {
    if (!cachedView) {
      return { personalViewCommonQuery: undefined, personalViewAggregationQuery: undefined };
    }

    const { filter, sort, group, columnMeta } = cachedView || {};
    const commonQuery = {
      ignoreViewQuery: true,
      filter,
      orderBy: (sort as ISort)?.sortObjs,
      groupBy: group,
      projection: visibleFieldIds,
    } as IGetRecordsRo;
    const aggregationQuery = {
      ...commonQuery,
      // statistic funcs for visible columns only — hidden columns are not part
      // of this view's projection
      field: buildStatisticFieldMap(columnMeta as IGridColumnMeta | undefined, visibleFieldIds),
    } as IAggregationRo;

    return {
      personalViewCommonQuery: commonQuery,
      personalViewAggregationQuery: aggregationQuery,
    };
  }, [cachedView, visibleFieldIds]);

  const updatePersonalView = useCallback(
    (actionKey: string, payload?: Record<string, unknown>) => {
      if (!payload) return;
      let newFields: IFieldVo[] = fields;

      if (actionKey === 'setField') {
        const payloadField = payload.field as IFieldVo;
        newFields = fields.map((field) =>
          field.id === payloadField.id ? { ...field, ...payloadField } : field
        );
      }

      if (actionKey === 'addField') {
        const payloadField = payload.field as IFieldVo;
        newFields = [...fields, payloadField];
      }

      if (actionKey === 'deleteField') {
        const payloadFieldId = payload.fieldId as string;
        newFields = fields.filter((field) => field.id !== payloadFieldId);
      }
      setPersonalViewMap(viewId, (prev) => validatePersonalViewProps(prev as IViewVo, newFields));
    },
    [fields, viewId, setPersonalViewMap]
  );

  const tableMatches = useMemo<ITableActionKey[]>(
    () => (isPersonalView ? ['setField', 'addField', 'deleteField'] : []),
    [isPersonalView]
  );
  useTableListener(tableId, tableMatches, updatePersonalView);

  return (
    <PersonalViewContext.Provider
      value={{
        isPersonalView,
        personalViewMap,
        personalViewCommonQuery,
        personalViewAggregationQuery,
      }}
    >
      {children}
    </PersonalViewContext.Provider>
  );
};
