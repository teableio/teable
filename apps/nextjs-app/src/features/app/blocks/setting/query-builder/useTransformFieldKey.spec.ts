import { FieldKeyType } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { transformRecordQueryFieldKey } from './useTransformFieldKey';

const fields = [
  {
    id: 'fldEmail',
    name: 'Email',
    dbFieldName: 'email',
  },
  {
    id: 'fldName',
    name: 'Customer Name',
    dbFieldName: 'customer_name',
  },
];

describe('transformRecordQueryFieldKey', () => {
  it('keeps filter and orderBy field ids when response fieldKeyType is name', () => {
    const query = {
      fieldKeyType: FieldKeyType.Name,
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'fldEmail', operator: 'is', value: null }],
      },
      orderBy: [{ fieldId: 'fldName', order: 'asc' }],
    } as IGetRecordsRo;

    const transformed = transformRecordQueryFieldKey(query, fields);

    expect(transformed.filter).toEqual(query.filter);
    expect(transformed.orderBy).toEqual(query.orderBy);
  });
});
