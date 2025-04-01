import {
  FieldKeyType,
  replaceFilter,
  replaceGroupBy,
  replaceOrderBy,
  replaceSearch,
} from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { useFields } from '@teable/sdk/hooks';
import { keyBy } from 'lodash';
import { useCallback } from 'react';

export function useTransformFieldKey() {
  const fields = useFields();

  return useCallback(
    (query: IGetRecordsRo) => {
      const fieldKeyType = query?.fieldKeyType ?? FieldKeyType.Name;
      const fieldMap = keyBy(fields, 'id');

      if (fieldKeyType === FieldKeyType.Id) {
        return query;
      }

      const transformedValue = { ...query };

      if (query.filter) {
        transformedValue.filter = replaceFilter(query.filter, fieldMap, fieldKeyType);
      }

      if (query.search) {
        transformedValue.search = replaceSearch(query.search, fieldMap, fieldKeyType);
      }

      if (query.groupBy) {
        transformedValue.groupBy = replaceGroupBy(query.groupBy, fieldMap, fieldKeyType);
      }

      if (query.orderBy) {
        transformedValue.orderBy = replaceOrderBy(query.orderBy, fieldMap, fieldKeyType);
      }

      return transformedValue;
    },
    [fields]
  );
}
