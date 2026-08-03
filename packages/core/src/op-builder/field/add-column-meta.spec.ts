import { OpName } from '../common';
import { AddColumnMetaBuilder } from './add-column-meta';

describe('addColumnMeta', () => {
  it('should detect add column meta', () => {
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
});
