import type { ISort, ISortItem } from './sort';
import { sortSchema, mergeWithDefaultSort } from './sort';
import { SortFunc } from './sort-func.enum';

describe('Sort Parse', () => {
  it('should parse sort', async () => {
    const sort: ISort = {
      sortObjs: [{ fieldId: 'fldxxxxxx', order: SortFunc.Asc }],
      manualSort: false,
    };

    const parse = sortSchema.parse(sort);

    expect(parse).toEqual(sort);
  });
});

describe('Sort mergeWithDefaultSort function test', () => {
  const defaultViewSortString =
    '{"sortObjs":[{"fieldId":"fld1xxx","order":"asc"}, {"fieldId":"fld2xxx","order":"desc"}],"manualSort":true}';

  const querySort: ISortItem[] = [
    {
      fieldId: 'fld3xxx',
      order: SortFunc.Asc,
    },
  ];

  const querySort1: ISortItem[] = [
    {
      fieldId: 'fld1xxx',
      order: SortFunc.Desc,
    },
  ];

  it('should return empty array, when past meaningless params', async () => {
    const mergedSort = mergeWithDefaultSort(null, undefined);
    expect(Array.isArray(mergedSort)).toBe(true);
    expect(mergedSort.length).toBe(0);
  });

  it('should return empty array, when manualSort is true with empty sort query', async () => {
    const mergedSort = mergeWithDefaultSort(defaultViewSortString, undefined);
    expect(Array.isArray(mergedSort)).toBe(true);
    expect(mergedSort.length).toBe(0);
  });

  it('should return merged sort, when sort query exists and no same field items', async () => {
    const mergedSort = mergeWithDefaultSort(defaultViewSortString, querySort);
    const presetSort = [
      ...querySort,
      { fieldId: 'fld1xxx', order: 'asc' },
      { fieldId: 'fld2xxx', order: 'desc' },
    ];
    expect(mergedSort).toEqual(presetSort);
  });

  it('should return merged orderby, when sort query include same fieldId items, query first', async () => {
    const mergedSort = mergeWithDefaultSort(defaultViewSortString, querySort1);
    const presetSort = [
      { fieldId: 'fld1xxx', order: 'desc' },
      { fieldId: 'fld2xxx', order: 'desc' },
    ];
    expect(mergedSort).toEqual(presetSort);
  });
});
