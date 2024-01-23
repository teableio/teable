import { ViewType } from './constant';
import type { IViewOptions } from './option.schema';
import { validateOptionsType, viewOptionsSchema } from './option.schema';

describe('view option Parse', () => {
  it('should parse view option', async () => {
    const option: IViewOptions = {
      coverUrl: 'https://www.xxx.com',
    };

    const parse = viewOptionsSchema.parse(option);

    expect(parse).toEqual(option);
  });
});

describe('view option validate', () => {
  test('should throw a error when pass form option to grid view', async () => {
    const formOption: IViewOptions = {
      coverUrl: 'https://www.xxx.com',
    };

    expect(() => validateOptionsType(ViewType.Grid, formOption)).toThrow();
  });
});
