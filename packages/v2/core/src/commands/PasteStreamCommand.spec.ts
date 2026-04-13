import { describe, expect, it } from 'vitest';

import { PasteStreamCommand } from './PasteStreamCommand';

describe('PasteStreamCommand', () => {
  it('parses clipboard text content and batch size', () => {
    const result = PasteStreamCommand.create({
      tableId: `tbl${'a'.repeat(16)}`,
      viewId: `viw${'b'.repeat(16)}`,
      ranges: [
        [0, 0],
        [1, 1],
      ],
      content: 'A\t1\nB\t2',
      batchSize: 5,
    });

    expect(result.isOk()).toBe(true);
    const command = result._unsafeUnwrap();
    expect(command.content).toEqual([
      ['A', '1'],
      ['B', '2'],
    ]);
    expect(command.batchSize).toBe(5);
  });
});
