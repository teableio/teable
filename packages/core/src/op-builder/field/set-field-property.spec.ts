import { OpName } from '../common';
import { SetFieldPropertyBuilder } from './set-field-property';

describe('SetFieldProperty', () => {
  it('should detect field name', () => {
    const setFieldPropertyBuilder = new SetFieldPropertyBuilder();
    expect(
      setFieldPropertyBuilder.build({ key: 'name', newValue: 'new', oldValue: 'old' })
    ).toEqual({
      p: ['name'],
      oi: 'new',
      od: 'old',
    });

    expect(setFieldPropertyBuilder.detect({ p: ['name'], oi: 'new', od: 'old' })).toEqual({
      name: OpName.SetFieldProperty,
      key: 'name',
      newValue: 'new',
      oldValue: 'old',
    });

    expect(
      setFieldPropertyBuilder.detect({ p: ['columnMeta', 'view'], oi: 'new', od: 'old' })
    ).toEqual(null);
  });
});
