import { is, or, and, isNot, hasNoneOf, isNotEmpty, FieldType, exactDate } from '@teable/core';
import type { IFilter, IFilterSet, ILinkCellValue, IOperator, IUserCellValue } from '@teable/core';
import { GroupPointType } from '@teable/openapi';
import type { IGetRecordsRo, IGroupHeaderPoint, IGroupPointsVo } from '@teable/openapi';
import { zonedTimeToUtc } from 'date-fns-tz';
import { useCallback, useMemo } from 'react';
import { useFields, useView, useViewId } from '../../../hooks';
import type { GridView, IFieldInstance } from '../../../model';
import { shouldFilterByDefaultValue } from '../../filter/view-filter/utils';
import { useGridCollapsedGroupStore } from '../store';

const FILTER_RELATED_FILED_TYPE_SET = new Set([
  FieldType.MultipleSelect,
  FieldType.User,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
  FieldType.Link,
]);

export const cellValue2FilterValue = (cellValue: unknown, field: IFieldInstance) => {
  const { type, isMultipleCellValue } = field;

  if (
    cellValue == null ||
    ![FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy, FieldType.Link].includes(type)
  )
    return cellValue;

  if (isMultipleCellValue) {
    return (cellValue as (IUserCellValue | ILinkCellValue)[])?.map((v) => v.id);
  }
  return (cellValue as IUserCellValue | ILinkCellValue).id;
};

export const generateFilterItem = (field: IFieldInstance, value: unknown) => {
  let operator: IOperator = isNot.value;
  const { id: fieldId, type, isMultipleCellValue, options } = field;

  if (shouldFilterByDefaultValue(field)) {
    operator = is.value;
    value = !value || null;
  } else if (value == null) {
    operator = isNotEmpty.value;
  } else if (type === FieldType.Date) {
    const timeZone =
      options?.formatting?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dateStr = zonedTimeToUtc(value as string, timeZone).toISOString();
    value = {
      exactDate: dateStr,
      mode: exactDate.value,
      timeZone,
    };
  } else if (FILTER_RELATED_FILED_TYPE_SET.has(type) && isMultipleCellValue) {
    operator = hasNoneOf.value;
  }

  return {
    fieldId,
    value: cellValue2FilterValue(value, field) as never,
    operator,
  };
};

export const useGridCollapsedGroup = (cacheKey: string, groupPoints: IGroupPointsVo) => {
  const activeViewId = useViewId();
  const view = useView(activeViewId) as GridView | undefined;
  const totalFields = useFields({ withHidden: true, withDenied: true });
  const { collapsedGroupMap, setCollapsedGroupMap } = useGridCollapsedGroupStore();

  const group = view?.group;

  const collapsedGroupIds = useMemo(() => {
    const collapsedGroupIds = collapsedGroupMap?.[cacheKey];
    return collapsedGroupIds?.length ? new Set(collapsedGroupIds) : null;
  }, [cacheKey, collapsedGroupMap]);

  const onCollapsedGroupChanged = useCallback(
    (groupIds: Set<string>) => {
      setCollapsedGroupMap(cacheKey, [...groupIds]);
    },
    [cacheKey, setCollapsedGroupMap]
  );

  const groupId2DataMap = useMemo(() => {
    if (groupPoints == null) return null;
    const groupIds: string[] = [];
    return groupPoints.reduce(
      (prev, cur) => {
        if (cur.type !== GroupPointType.Header) {
          return prev;
        }
        const { id, depth } = cur;

        groupIds[depth] = id;
        prev[id] = { ...cur, path: groupIds.slice(0, depth + 1) };
        return prev;
      },
      {} as Record<string, IGroupHeaderPoint & { path: string[] }>
    );
  }, [groupPoints]);

  const fieldId2DataMap = useMemo(() => {
    return totalFields.reduce(
      (prev, field) => {
        prev[field.id] = field;
        return prev;
      },
      {} as Record<string, IFieldInstance>
    );
  }, [totalFields]);

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const viewGroupQuery = useMemo(() => {
    if (!group?.length) {
      return undefined;
    }

    if (groupId2DataMap == null || collapsedGroupIds == null || !collapsedGroupIds.size) {
      return { groupBy: group as IGetRecordsRo['groupBy'] };
    }

    const filterQuery: IFilter = {
      conjunction: and.value,
      filterSet: [],
    };

    for (const groupId of collapsedGroupIds) {
      const groupData = groupId2DataMap[groupId];

      if (groupData == null) continue;

      const { path } = groupData;
      const innerFilterSet: IFilterSet = {
        conjunction: or.value,
        filterSet: [],
      };

      path.forEach((pathGroupId) => {
        const pathGroupData = groupId2DataMap[pathGroupId];

        if (pathGroupData == null) return;

        const { depth } = pathGroupData;
        const curGroup = group[depth];

        if (curGroup == null) return;

        const { fieldId } = curGroup;
        const field = fieldId2DataMap[fieldId];

        if (field == null) return;

        const filterItem = generateFilterItem(field, pathGroupData.value);
        innerFilterSet.filterSet.push(filterItem);
      });

      filterQuery.filterSet.push(innerFilterSet);
    }

    return { filter: filterQuery, groupBy: group as IGetRecordsRo['groupBy'] };
  }, [groupId2DataMap, collapsedGroupIds, fieldId2DataMap, group]);

  return useMemo(
    () => ({
      viewGroupQuery,
      collapsedGroupIds,
      onCollapsedGroupChanged,
    }),
    [viewGroupQuery, collapsedGroupIds, onCollapsedGroupChanged]
  );
};
