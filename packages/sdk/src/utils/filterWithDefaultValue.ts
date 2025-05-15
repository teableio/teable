import type {
  IDateFilter,
  IFieldVo,
  IFilter,
  IFilterItem,
  ILinkCellValue,
  ILinkFieldOptions,
  IRecord,
  IUserCellValue,
} from '@teable/core';
import {
  assertNever,
  contains,
  FieldType,
  hasAllOf,
  isExactly,
  isMeTag,
  is,
  or,
  today,
  tomorrow,
  yesterday,
  exactDate as exactDateConst,
  exactFormatDate,
} from '@teable/core';
import { getRecords, getUserCollaborators } from '@teable/openapi';
import { keyBy } from 'lodash';

// eslint-disable-next-line @typescript-eslint/naming-convention
const VALIDATE_FILTER_OPERATORS = [is.value, isExactly.value, contains.value, hasAllOf.value];

export const validateFilterOperators = (filter: IFilter | IFilterItem | undefined): boolean => {
  if (!filter) return false;
  if ('filterSet' in filter) {
    if (filter.conjunction === or.value && filter.filterSet.length > 1) return false;
    return filter.filterSet.some((item) => validateFilterOperators(item));
  }
  if ('operator' in filter) {
    return VALIDATE_FILTER_OPERATORS.some((operator) => operator === filter.operator);
  }
  return false;
};

export const generateValueByFilteredField = ({
  value,
  field,
  currentUserId,
  userMap,
  linkMap,
}: {
  value: unknown;
  field: IFieldVo;
  currentUserId: string;
  userMap: Record<string, IUserCellValue>;
  linkMap: Record<string, ILinkCellValue>;
  // eslint-disable-next-line sonarjs/cognitive-complexity
}): unknown => {
  const { type, isMultipleCellValue } = field;

  if (value == null) return null;

  switch (type) {
    case FieldType.SingleLineText:
    case FieldType.LongText:
    case FieldType.Number:
    case FieldType.Rating:
    case FieldType.Checkbox:
    case FieldType.Attachment:
    case FieldType.SingleSelect:
    case FieldType.MultipleSelect: {
      return value;
    }
    case FieldType.Date: {
      const { exactDate, mode } = value as IDateFilter;
      const now = new Date();

      if (mode === today.value) return now.toISOString();
      if (mode === tomorrow.value) {
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        return tomorrow.toISOString();
      }
      if (mode === yesterday.value) {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        return yesterday.toISOString();
      }
      if (mode === exactDateConst.value || mode === exactFormatDate.value) {
        return exactDate;
      }
      return null;
    }
    case FieldType.User: {
      if (isMultipleCellValue) {
        return (value as string[])?.map((v) => {
          const id = isMeTag(v) ? currentUserId : v;
          return userMap[id] ?? { title: '', id };
        });
      }
      const id = isMeTag(value as string) ? currentUserId : (value as string);
      return userMap[id] ?? { title: '', id };
    }
    case FieldType.Link: {
      return isMultipleCellValue
        ? (value as string[])?.map((v) => linkMap[v] ?? { title: '', id: v })
        : linkMap[value as string] ?? { title: '', id: value };
    }
    default:
      assertNever(type as never);
  }
};

export const extractDefaultFieldsFromFilters = async ({
  filter,
  fieldMap,
  currentUserId,
  baseId,
  tableId,
  isAsync = false,
}: {
  filter: IFilter | undefined;
  fieldMap: Record<string, IFieldVo>;
  currentUserId: string;
  baseId?: string;
  tableId?: string;
  isAsync?: boolean;
}): Promise<Record<string, unknown>> => {
  const result: { [fieldId: string]: unknown } = {};
  let repeatedFieldIds = new Set<string>();
  let collectedUserIds: string[] = [];
  const collectedLinkIdMap: Record<string, string[]> = {};
  let collectedUserMap: Record<string, IUserCellValue> = {};
  let collectedLinkMap: Record<string, ILinkCellValue> = {};

  const filterItemHandler = async (
    filter: IFilterItem | null | undefined,
    fieldMap: Record<string, IFieldVo>,
    callback: (field: IFieldVo, value: unknown) => Promise<void>
  ) => {
    const { fieldId, operator, value } = filter || {};

    if (!VALIDATE_FILTER_OPERATORS.includes(operator as never) || !fieldId || !fieldMap[fieldId]) {
      return;
    }

    const field = fieldMap[fieldId];

    if (fieldId in result) {
      delete result[fieldId];
      repeatedFieldIds.add(fieldId);
    } else if (!repeatedFieldIds.has(fieldId) && !field.isComputed) {
      await callback(field, value);
    }
  };

  const traverse = async (
    filter: IFilter | IFilterItem | undefined,
    fieldMap: Record<string, IFieldVo>
  ) => {
    if (filter && 'filterSet' in filter) {
      filter.filterSet.forEach((item) => traverse(item, fieldMap));
    } else if (filter) {
      await filterItemHandler(filter, fieldMap, async (field, value) => {
        result[field.id] = generateValueByFilteredField({
          value,
          field,
          currentUserId,
          userMap: collectedUserMap,
          linkMap: collectedLinkMap,
        });
      });
    }
  };

  const collectRelationIds = (
    filter: IFilter | IFilterItem | undefined,
    fieldMap: Record<string, IFieldVo>
  ) => {
    if (filter && 'filterSet' in filter) {
      filter.filterSet.forEach((item) => collectRelationIds(item, fieldMap));
    } else if (filter) {
      filterItemHandler(filter, fieldMap, async (field, value) => {
        const { type, isMultipleCellValue } = field;

        if (value == null) return;
        if (![FieldType.User, FieldType.Link].includes(type)) return;

        const ids = isMultipleCellValue ? (value as string[]) : [value as string];

        if (type === FieldType.User) {
          collectedUserIds = [...new Set([...collectedUserIds, ...ids])];
        } else if (type === FieldType.Link) {
          const foreignTableId = (field.options as ILinkFieldOptions).foreignTableId;
          collectedLinkIdMap[foreignTableId] = [
            ...new Set([...(collectedLinkIdMap[foreignTableId] || []), ...ids]),
          ];
        }
      });
    }
  };

  if (!validateFilterOperators(filter)) return result;

  if (!isAsync || !baseId || !tableId) {
    traverse(filter, fieldMap);
    return result;
  }

  collectRelationIds(filter, fieldMap);

  if (collectedUserIds.length > 0) {
    const { users } = await getUserCollaborators(baseId, {
      includeSystem: true,
    }).then((res) => res.data);
    const cs = users.map((c) => ({
      id: c.id,
      title: c.name,
      email: c.email,
      avatarUrl: c.avatar,
    }));
    collectedUserMap = keyBy(cs, 'id');
  }

  if (Object.keys(collectedLinkIdMap).length > 0) {
    let allRecords: IRecord[] = [];
    for (const [tableId, ids] of Object.entries(collectedLinkIdMap)) {
      const { records } = (
        await getRecords(tableId, {
          selectedRecordIds: ids,
        })
      ).data;
      allRecords = [...allRecords, ...records];
    }
    const links = allRecords.map((r) => ({
      id: r.id,
      title: r.name,
    }));
    collectedLinkMap = keyBy(links, 'id');
  }

  repeatedFieldIds = new Set<string>();

  traverse(filter, fieldMap);

  return result;
};
