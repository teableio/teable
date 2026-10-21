import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { TableId } from '../../domain/table/TableId';
import { RecordsBatchCreated } from '../../domain/table/events/RecordsBatchCreated';
import { recordsBatchCreatedProjectionCodec } from './recordProjectionCodecs';

const MAX_PROJECTION_PAYLOAD_BYTES = 16 * 1024 * 1024;

describe('recordsBatchCreatedProjectionCodec', () => {
  it('keeps a 500-row 80-field import payload under the journal cap', () => {
    const tableId = TableId.generate()._unsafeUnwrap();
    const baseId = BaseId.generate()._unsafeUnwrap();
    const cell = 'x'.repeat(1024);
    const event = RecordsBatchCreated.create({
      tableId,
      baseId,
      source: { type: 'import' },
      records: Array.from({ length: 500 }, (_, recordIndex) => ({
        recordId: `rec${String(recordIndex).padStart(16, '0')}`,
        fields: Array.from({ length: 80 }, (_, fieldIndex) => ({
          fieldId: `fld${String(fieldIndex).padStart(16, '0')}`,
          value: cell,
        })),
      })),
    });

    const encoded = recordsBatchCreatedProjectionCodec.encode(event);
    expect(encoded.isOk()).toBe(true);
    const bytes = new TextEncoder().encode(JSON.stringify(encoded._unsafeUnwrap())).byteLength;
    expect(bytes).toBeLessThan(MAX_PROJECTION_PAYLOAD_BYTES);
    expect(bytes).toBeGreaterThan(1_000_000);
  });

  it('does not split a surrogate pair when truncating long text', () => {
    const event = RecordsBatchCreated.create({
      tableId: TableId.generate()._unsafeUnwrap(),
      baseId: BaseId.generate()._unsafeUnwrap(),
      source: { type: 'import' },
      records: [
        {
          recordId: 'rec0000000000000001',
          fields: [{ fieldId: 'fld0000000000000001', value: `${'a'.repeat(255)}🧀 tail` }],
        },
      ],
    });

    const payload = recordsBatchCreatedProjectionCodec.encode(event)._unsafeUnwrap() as {
      records: Array<{ fields: Array<{ value: string }> }>;
    };
    const value = payload.records[0]!.fields[0]!.value;
    expect(value).toBe('a'.repeat(255));
    expect(JSON.stringify(value)).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
  });
});
