import type { IFieldVo } from '@teable/core';
import { FieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { buildFillSelectionPaste } from './fill';

describe('buildFillSelectionPaste', () => {
  const textField = {
    id: 'fldText',
    name: 'Text',
    dbFieldName: 'text',
    type: FieldType.SingleLineText,
    options: {},
    cellValueType: 'string',
    dbFieldType: 'TEXT',
  } as unknown as IFieldVo;

  it('builds a downward fill payload for an empty source cell so targets can be cleared', () => {
    const payload = buildFillSelectionPaste({
      selectionRanges: [
        [0, 0],
        [0, 0],
      ],
      targetEndRealRowIndex: 2,
      rawContent: [[undefined]],
      headers: [textField],
      fields: [textField],
    });

    expect(payload).toEqual({
      content: [[null], [null]],
      header: [textField],
      ranges: [
        [0, 1],
        [0, 2],
      ],
    });
  });
});
