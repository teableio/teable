import { ViewType } from './constant';
import type { IViewOptionRo } from './option.schema';
import { validateOptionType, viewOptionRoSchema } from './option.schema';

describe('view option Parse', () => {
  it('should parse view option', async () => {
    const option: IViewOptionRo = {
      coverUrl: 'https://www.xxx.com',
    };

    const parse = viewOptionRoSchema.parse(option);

    expect(parse).toEqual(option);
  });
});

describe('view option validate', () => {
  test('should throw a error when pass form option to grid view', async () => {
    const formOption: IViewOptionRo = {
      coverUrl: 'https://www.xxx.com',
    };

    expect(() => validateOptionType(ViewType.Grid, formOption)).toThrow();
  });
});
