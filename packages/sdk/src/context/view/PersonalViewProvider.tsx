import type { IFieldVo, ISort, ITableActionKey, IViewVo, StatisticsFunc } from '@teable/core';
import type { IGetRecordsRo, IAggregationRo } from '@teable/openapi';
import { useCallback, useContext, useMemo } from 'react';
import { useFields, useTableId, useTableListener, useView } from '../../hooks';
import { validatePersonalViewProps } from '../../utils/personalView';
import { ShareViewContext } from '../table';
import { PersonalViewContext } from './PersonalViewContext';
import { usePersonalViewStore } from './store';

interface IPersonalViewProviderProps {
  children: React.ReactNode;
}

export const PersonalViewProvider = ({ children }: IPersonalViewProviderProps) => {
  const view = useView();
  const tableId = useTableId();
  const visibleFields = useFields();
  const fields = useFields({ withHidden: true, withDenied: true });
  const { shareId } = useContext(ShareViewContext) ?? {};
  const { personalViewMap, setPersonalViewMap } = usePersonalViewStore();

  const viewId = view?.id ?? '';
  const cachedView = personalViewMap?.[viewId];
  const isPersonalView = Boolean(cachedView);
  const visibleFieldIds = visibleFields.map(({ id }) => id);

  const { personalViewCommonQuery, personalViewAggregationQuery } = useMemo(() => {
    if (!cachedView || shareId) {
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
      field: Object.entries(columnMeta || {})
        .map(([fieldId, { statisticFunc }]) => {
          if (!statisticFunc) return;
          return {
            fieldId,
            statisticFunc,
          };
        })
        .filter((item): item is { fieldId: string; statisticFunc: StatisticsFunc } => Boolean(item))
        .reduce(
          (acc, { fieldId, statisticFunc }) => {
            if (!acc[statisticFunc]) {
              acc[statisticFunc] = [];
            }
            acc[statisticFunc].push(fieldId);
            return acc;
          },
          {} as Record<StatisticsFunc, string[]>
        ),
    } as IAggregationRo;

    return {
      personalViewCommonQuery: commonQuery,
      personalViewAggregationQuery: aggregationQuery,
    };
  }, [cachedView, shareId, visibleFieldIds]);

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
