import {
  is,
  and,
  isNot,
  hasNoneOf,
  isNotEmpty,
  FieldType,
  GroupPointType,
} from '@teable-group/core';
import type {
  IFilter,
  IGetRecordsRo,
  IGroupHeaderPoint,
  IGroupPointsVo,
  IOperator,
} from '@teable-group/core';
import { useCallback, useMemo } from 'react';
import { useFields, useView, useViewId } from '../../../hooks';
import type { GridView, IFieldInstance } from '../../../model';
import { useGridCollapsedGroupStore } from '../store';

const FILTER_RELATED_FILED_TYPE_SET = new Set([
  FieldType.MultipleSelect,
  FieldType.User,
  FieldType.Link,
]);

export const useGridCollapsedGroup = (cacheKey: string, groupPoints: IGroupPointsVo) => {
  const activeViewId = useViewId();
  const view = useView(activeViewId) as GridView | undefined;
  const totalFields = useFields({ withHidden: true });
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
    return groupPoints.reduce(
      (prev, cur) => {
        if (cur.type === GroupPointType.Header) {
          prev[cur.id] = cur;
        }
        return prev;
      },
      {} as Record<string, IGroupHeaderPoint>
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

      const { depth } = groupData;
      let value = groupData.value;
      const curGroup = group[depth];

      if (curGroup == null) continue;

      const { fieldId } = curGroup;
      const field = fieldId2DataMap[fieldId];

      if (field == null) continue;

      let operator: IOperator = isNot.value;
      const { type, isMultipleCellValue } = field;

      if (type === FieldType.Checkbox) {
        operator = is.value;
        value = !value || null;
      } else if (value == null) {
        operator = isNotEmpty.value;
      } else if (FILTER_RELATED_FILED_TYPE_SET.has(type) && isMultipleCellValue) {
        operator = hasNoneOf.value;
      }

      filterQuery.filterSet.push({
        fieldId,
        value: value as never,
        operator,
      });
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
