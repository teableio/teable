import { RecordOpBuilder } from '@teable/core';
import { changeToOp, formatChangesToOps, mergeDuplicateChange } from './changes'; // Change './yourFile' to the correct path.

describe('changeToOp', () => {
  it('should create an operation from a cell change', () => {
    const change = {
      tableId: 't1',
      recordId: 'r1',
      fieldId: 'f1',
      oldValue: 'A',
      newValue: 'B',
    };

    const result = changeToOp(change);

    const expected = RecordOpBuilder.editor.setRecord.build({
      fieldId: 'f1',
      oldCellValue: 'A',
      newCellValue: 'B',
    });

    expect(result).toEqual(expected);
  });
});

describe('formatChangesToOps', () => {
  it('should format multiple changes into operations', () => {
    const changes = [
      {
        tableId: 't1',
        recordId: 'r1',
        fieldId: 'f1',
        oldValue: 'A',
        newValue: 'B',
      },
      {
        tableId: 't1',
        recordId: 'r1',
        fieldId: 'f2',
        oldValue: 'X',
        newValue: 'Y',
      },
    ];

    const result = formatChangesToOps(changes);

    expect(result).toEqual({
      t1: {
        r1: [
          RecordOpBuilder.editor.setRecord.build({
            fieldId: 'f1',
            oldCellValue: 'A',
            newCellValue: 'B',
          }),
          RecordOpBuilder.editor.setRecord.build({
            fieldId: 'f2',
            oldCellValue: 'X',
            newCellValue: 'Y',
          }),
        ],
      },
    });
  });
});

describe('mergeDuplicateChange', () => {
  it('should merge duplicate changes', () => {
    const changes = [
      {
        tableId: 't1',
        recordId: 'r1',
        fieldId: 'f1',
        oldValue: 'A',
        newValue: 'C',
      },
      {
        tableId: 't1',
        recordId: 'r1',
        fieldId: 'f1',
        oldValue: 'A',
        newValue: 'D',
      },
      {
        tableId: 't2',
        recordId: 'r2',
        fieldId: 'f2',
        oldValue: 'B',
        newValue: 'D',
      },
    ];

    const result = mergeDuplicateChange(changes);

    expect(result).toEqual([
      {
        tableId: 't1',
        recordId: 'r1',
        fieldId: 'f1',
        oldValue: 'A',
        newValue: 'D',
      },
      {
        tableId: 't2',
        recordId: 'r2',
        fieldId: 'f2',
        oldValue: 'B',
        newValue: 'D',
      },
    ]);
  });
});
