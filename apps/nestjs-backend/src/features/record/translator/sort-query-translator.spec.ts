import type { ISortItem } from '@teable-group/core';
import type { IFieldInstance } from '../../field/model/factory';
import { SortQueryTranslator } from './sort-query-translator';

describe('SortQueryTranslator', () => {
  it('should return empty array, if the fields is undefined', () => {
    const translatedOrderBy = SortQueryTranslator.translateToOrderQuery([], undefined);
    expect(Array.isArray(translatedOrderBy)).toBe(true);
    expect(translatedOrderBy.length).toBe(0);
  });

  it('should return right orderBy', () => {
    const orderBy: ISortItem[] = [
      {
        fieldId: 'fldOxH1uuemSQZmoEd0',
        order: 'asc',
      },
      {
        fieldId: 'fldWKxNpJ0XjK2n7Bp8',
        order: 'desc',
      },
    ];
    const presetFields = {
      fldOxH1uuemSQZmoEd0: {
        dbFieldName: 'Name_fldOxH1uuemSQZmoEd0',
      },
      fldWKxNpJ0XjK2n7Bp8: {
        dbFieldName: 'Count_fldWKxNpJ0XjK2n7Bp8',
      },
    } as unknown as { [fieldId: string]: IFieldInstance };
    const assertRes = [
      {
        column: 'Name_fldOxH1uuemSQZmoEd0',
        order: 'asc',
      },
      {
        column: 'Count_fldWKxNpJ0XjK2n7Bp8',
        order: 'desc',
      },
    ];
    const translatedOrderBy = SortQueryTranslator.translateToOrderQuery(orderBy, presetFields);
    expect(translatedOrderBy).toEqual(assertRes);
  });
});
