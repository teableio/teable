import { GroupPointType, hasNoneOf, FieldType, isNot, isNotEmpty, and } from '@teable-group/core';
import type { IFilter, IGroupHeaderPoint, IGroupPointsVo, IOperator } from '@teable-group/core';
import { useCallback, useEffect, useMemo } from 'react';
import { useLocalStorage } from 'react-use';
import { LocalStorageKeys } from '../../../config';
import { useFields, useView, useViewId } from '../../../hooks';
import type { GridView, IFieldInstance } from '../../../model';

const FILTER_RELATED_FILED_TYPE_SET = new Set([
  FieldType.MultipleSelect,
  FieldType.User,
  FieldType.Link,
]);

export const useGridCollapsedGroup = (cacheKey: string, groupPoints: IGroupPointsVo) => {
  const activeViewId = useViewId();
  const view = useView(activeViewId) as GridView | undefined;
  const totalFields = useFields({ withHidden: true });
  const [groupCollapsedMap, setGroupCollapsedMap] = useLocalStorage<Record<string, string[]>>(
    LocalStorageKeys.ViewGridCollapsedGroup,
    {}
  );

  const group = view?.group;

  const collapsedGroupIds = useMemo(() => {
    const collapsedGroupIds = groupCollapsedMap?.[cacheKey];
    return collapsedGroupIds?.length ? new Set(collapsedGroupIds) : null;
  }, [cacheKey, groupCollapsedMap]);

  const onCollapsedGroupChanged = useCallback(
    (groupIds: Set<string>) => {
      setGroupCollapsedMap((prev) => {
        const newGroupCollapsedMap = { ...prev };

        if (groupIds.size === 0) {
          delete newGroupCollapsedMap[cacheKey];
          return newGroupCollapsedMap;
        }

        newGroupCollapsedMap[cacheKey] = [...groupIds];
        return newGroupCollapsedMap;
      });
    },
    [cacheKey, setGroupCollapsedMap]
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

  const viewGroupQuery = useMemo(() => {
    if (!group?.length) {
      return undefined;
    }

    if (groupId2DataMap == null || collapsedGroupIds == null || !collapsedGroupIds.size) {
      return { groupBy: group };
    }

    const filterQuery: IFilter = {
      conjunction: and.value,
      filterSet: [],
    };

    for (const groupId of collapsedGroupIds) {
      const groupData = groupId2DataMap[groupId];

      if (groupData == null) continue;

      const { value, depth } = groupData;
      const curGroup = group[depth];

      if (curGroup == null) continue;

      const { fieldId } = curGroup;
      const field = fieldId2DataMap[fieldId];

      if (field == null) continue;

      let operator: IOperator = isNot.value;
      const { type, isMultipleCellValue } = field;

      if (value == null) {
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

    return { filter: filterQuery, groupBy: group };
  }, [groupId2DataMap, collapsedGroupIds, fieldId2DataMap, group]);

  useEffect(() => {
    setGroupCollapsedMap((prev) => {
      const newGroupCollapsedMap = { ...prev };
      delete newGroupCollapsedMap[cacheKey];
      return newGroupCollapsedMap;
    });
  }, [cacheKey, group, setGroupCollapsedMap]);

  return useMemo(
    () => ({
      viewGroupQuery,
      collapsedGroupIds,
      onCollapsedGroupChanged,
    }),
    [viewGroupQuery, collapsedGroupIds, onCollapsedGroupChanged]
  );
};
