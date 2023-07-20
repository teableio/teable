import { OpName } from '../../common';
import { AddColumnMetaBuilder } from '../add-column-meta';
import { SetFieldNameBuilder } from '../set-field-name';

describe('field op builder tests', () => {
  it('add column meta', () => {
    const addColumnMetaBuilder = new AddColumnMetaBuilder();
    expect(
      addColumnMetaBuilder.build({
        viewId: 'viw123',
        newMetaValue: { order: 1 },
        oldMetaValue: { order: 2 },
      })
    ).toEqual({
      p: ['columnMeta', 'viw123'],
      oi: { order: 1 },
      od: { order: 2 },
    });

    expect(
      addColumnMetaBuilder.detect({
        p: ['columnMeta', 'viw123'],
        oi: { order: 1 },
        od: { order: 2 },
      })
    ).toEqual({
      name: OpName.AddColumnMeta,
      viewId: 'viw123',
      newMetaValue: { order: 1 },
      oldMetaValue: { order: 2 },
    });

    expect(
      addColumnMetaBuilder.detect({ p: ['columnMeta', 'viw123'], li: 'new', ld: 'old' })
    ).toEqual(null);
  });

  it('set field name', () => {
    const setFieldNameBuilder = new SetFieldNameBuilder();
    expect(setFieldNameBuilder.build({ newName: 'new', oldName: 'old' })).toEqual({
      p: ['name'],
      oi: 'new',
      od: 'old',
    });

    expect(setFieldNameBuilder.detect({ p: ['name'], oi: 'new', od: 'old' })).toEqual({
      name: OpName.SetFieldName,
      newName: 'new',
      oldName: 'old',
    });

    expect(setFieldNameBuilder.detect({ p: ['names'], oi: 'new', od: 'old' })).toEqual(null);
  });
});
