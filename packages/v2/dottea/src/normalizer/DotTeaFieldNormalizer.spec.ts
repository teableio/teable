import { describe, expect, it } from 'vitest';

import { buildTableFromInput } from '../../../core/src/commands/TableInputParser';
import { normalizeField } from './DotTeaFieldNormalizer';

describe('DotTeaFieldNormalizer', () => {
  it('deduplicates select choices that only differ by surrounding whitespace', () => {
    const normalized = normalizeField(
      {
        id: `fld${'s'.repeat(16)}`,
        type: 'singleSelect',
        name: 'T次',
        options: {
          choices: [
            { id: 'chom4XbfXuh', name: 'T1', color: 'purple' },
            { id: 'cho0eYy9LIM', name: ' T1', color: 'purpleLight2' },
            { id: 'chojvEzfz4d', name: 'T2', color: 'blueLight2' },
          ],
          defaultValue: ' T1',
        },
      },
      new Map()
    );

    expect(normalized.options).toEqual({
      choices: [
        { id: 'chom4XbfXuh', name: 'T1', color: 'purple' },
        { id: 'chojvEzfz4d', name: 'T2', color: 'blueLight2' },
      ],
      defaultValue: 'T1',
    });

    const result = buildTableFromInput({
      baseId: `bse${'a'.repeat(16)}`,
      tableId: `tbl${'b'.repeat(16)}`,
      name: 'Import Test',
      fields: [
        {
          id: `fld${'p'.repeat(16)}`,
          type: 'singleLineText',
          name: 'Name',
          isPrimary: true,
        },
        {
          id: normalized.id,
          type: normalized.type,
          name: normalized.name,
          options: normalized.options,
        },
      ],
    });

    expect(result.isOk()).toBe(true);
  });

  it('downgrades formulas that reference missing fields to singleLineText', () => {
    const normalized = normalizeField(
      {
        id: `fld${'f'.repeat(16)}`,
        type: 'formula',
        name: 'Broken Formula',
        options: {
          expression: 'SUM({fldaaaaaaaaaaaaaaaa},{fldbbbbbbbbbbbbbbbb})',
        },
      },
      new Map([['fldaaaaaaaaaaaaaaaa', 'number']])
    );

    expect(normalized.type).toBe('singleLineText');
    expect(normalized.options).toEqual({
      expression: 'SUM({fldaaaaaaaaaaaaaaaa},{fldbbbbbbbbbbbbbbbb})',
    });
  });
});
