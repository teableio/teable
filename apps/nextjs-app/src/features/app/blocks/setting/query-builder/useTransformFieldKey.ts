import { FieldKeyType, replaceGroupBy, replaceSearch } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { useFields } from '@teable/sdk/hooks';
import { keyBy } from 'lodash';
import { useCallback } from 'react';

type IQueryBuilderField = {
  id: string;
  name: string;
  dbFieldName: string;
};

export function transformRecordQueryFieldKey(query: IGetRecordsRo, fields: IQueryBuilderField[]) {
  const fieldKeyType = query?.fieldKeyType ?? FieldKeyType.Name;
  const fieldMap = keyBy(fields, 'id');

  if (fieldKeyType === FieldKeyType.Id) {
    return query;
  }

  const transformedValue = { ...query };

  if (query.search) {
    transformedValue.search = replaceSearch(query.search, fieldMap, fieldKeyType);
  }

  if (query.groupBy) {
    transformedValue.groupBy = replaceGroupBy(query.groupBy, fieldMap, fieldKeyType);
  }

  return transformedValue;
}

export function useTransformFieldKey() {
  const fields = useFields();

  return useCallback(
    (query: IGetRecordsRo) => {
      return transformRecordQueryFieldKey(query, fields);
    },
    [fields]
  );
}
