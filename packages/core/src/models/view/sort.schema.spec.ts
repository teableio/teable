import type { ISort } from './sort';
import { sortSchema } from './sort';

describe('Sort Parse', () => {
  it('should parse sort', async () => {
    const sort: ISort = { sortObjs: [{ fieldId: 'id', order: 'asc' }], shouldAutoSort: true };

    const parse = sortSchema.parse(sort);

    expect(parse).toEqual(sort);
  });
});
