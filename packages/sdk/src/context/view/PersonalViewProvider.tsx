import type {
  IFieldVo,
  IFilter,
  IGridColumnMeta,
  IGroup,
  ISort,
  ITableActionKey,
  IViewVo,
} from '@teable/core';
import {
  stripFilterByReadableFieldIds,
  stripInProgressFilterItems,
  stripSortByReadableFieldIds,
} from '@teable/core';
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
    // The personal-view query inlines persisted defaults with
    // ignoreViewQuery: true, which makes them indistinguishable from explicit
    // client conditions server-side (where unreadable-field references are
    // rejected). Strip entries the current user cannot read so a permission
    // change cannot break the subscription; undefined until fields load.
    const readableFieldIds = fields.length
      ? new Set(fields.filter((field) => field.canReadFieldRecord !== false).map(({ id }) => id))
      : undefined;
    const cellValueTypeMap = fields.reduce<Record<string, Pick<IFieldVo, 'cellValueType'>>>(
      (acc, field) => {
        acc[field.id] = { cellValueType: field.cellValueType };
        return acc;
      },
      {}
    );
    const commonQuery = {
      ignoreViewQuery: true,
      // in-progress conditions (field+operator picked, value still empty) must
      // not reach the query: every content change re-creates the record
      // subscription, so an unfinished condition flashes the whole grid, and
      // v2 compiles `is`/`isNot` with a null value to IS NULL, hiding rows
      filter: stripInProgressFilterItems(
        stripFilterByReadableFieldIds(filter as IFilter, readableFieldIds),
        cellValueTypeMap
      ),
      orderBy: stripSortByReadableFieldIds(sort as ISort, readableFieldIds)?.sortObjs,
      groupBy: readableFieldIds
        ? (group as IGroup)?.filter((item) => readableFieldIds.has(item.fieldId))
        : (group as IGroup),
      // projection is a field-id set, not a sequence: keep it order-stable so
      // downstream cache keys don't churn when columns are reordered
      projection: [...visibleFieldIds].sort(),
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
  }, [cachedView, visibleFieldIds, fields]);

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
