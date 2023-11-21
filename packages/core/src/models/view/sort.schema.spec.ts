import type { ISort } from './sort';
import { sortSchema, mergeWithDefaultSort } from './sort';

describe('Sort Parse', () => {
  it('should parse sort', async () => {
    const sort: ISort = { sortObjs: [{ fieldId: 'id', order: 'asc' }], manualSort: true };

    const parse = sortSchema.parse(sort);

    expect(parse).toEqual(sort);
  });
});

describe('Sort mergeWithDefaultSort function test', () => {
  const defaultViewSortString =
    '{"sortObjs":[{"fieldId":"fieldId","order":"asc"}, {"fieldId":"fieldId2","order":"desc"}],"manualSort":false}';

  const querySort: ISort['sortObjs'] = [
    {
      fieldId: 'queryFieldId',
      order: 'asc',
    },
  ];

  const querySort1: ISort['sortObjs'] = [
    {
      fieldId: 'fieldId',
      order: 'desc',
    },
  ];

  it('should return empty array, when past meaningless params', async () => {
    const mergedSort = mergeWithDefaultSort(null, undefined);
    expect(Array.isArray(mergedSort)).toBe(true);
    expect(mergedSort.length).toBe(0);
  });

  it('should return empty array, when manualSort is false with empty sort query', async () => {
    const mergedSort = mergeWithDefaultSort(defaultViewSortString, undefined);
    expect(Array.isArray(mergedSort)).toBe(true);
    expect(mergedSort.length).toBe(0);
  });

  it('should return merged sort, when sort query exists and no same field items', async () => {
    const mergedSort = mergeWithDefaultSort(defaultViewSortString, querySort);
    const presetSort = [
      { fieldId: 'fieldId', order: 'asc' },
      { fieldId: 'fieldId2', order: 'desc' },
      {
        fieldId: 'queryFieldId',
        order: 'asc',
      },
    ];
    expect(mergedSort).toEqual(presetSort);
  });

  it('should return merged orderby, when sort query include same fieldId items, query first', async () => {
    const mergedSort = mergeWithDefaultSort(defaultViewSortString, querySort1);
    const presetSort = [
      { fieldId: 'fieldId', order: 'desc' },
      { fieldId: 'fieldId2', order: 'desc' },
    ];
    expect(mergedSort).toEqual(presetSort);
  });
});
