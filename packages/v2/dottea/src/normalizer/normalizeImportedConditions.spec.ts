import type { DotTeaFieldInput, DotTeaTableInput, NormalizedDotTeaField } from '@teable/v2-core';
import { expect, it } from 'vitest';
import { normalizeImportedConditions } from './normalizeImportedConditions';

it('propagates a disconnected filter across longer table chains with linear field access', () => {
  for (const depth of [16, 64, 256]) {
    let reads = 0;
    const tables: DotTeaTableInput[] = [];
    const fields: NormalizedDotTeaField[][] = [];
    for (let i = depth; i >= 0; i--) {
      const id = `fld${i}`;
      const type = i === 0 ? 'number' : 'conditionalRollup';
      const raw: DotTeaFieldInput = {
        get id() {
          reads++;
          return id;
        },
        type,
        name: id,
        cellValueType: 'number',
      };
      tables.push({ name: `Level ${i}`, id: `tbl${i}`, fields: [raw] });
      fields.push([
        i === 0
          ? { id, name: id, type: 'singleLineText' }
          : {
              id,
              name: id,
              type,
              config: {
                foreignTableId: `tbl${i - 1}`,
                condition: {
                  filter: {
                    conjunction: 'and',
                    filterSet: [{ fieldId: `fld${i - 1}`, operator: 'isGreater', value: 0 }],
                  },
                },
              },
            },
      ]);
    }
    normalizeImportedConditions(tables, fields);
    expect(fields.every(([field]) => field.type === 'singleLineText')).toBe(true);
    expect(reads).toBeLessThanOrEqual(6 * (depth + 1));
    console.info('T8823_CHAIN', { depth, reads });
  }
});
