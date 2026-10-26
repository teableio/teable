import { describe, expect, it } from 'vitest';

import { deriveTrigger, parseDeadLetterPayload, type ReproDeadLetter } from './deadLetter';
import type { ReproStructure } from './structure';

const TABLE = 'tblAAAAAAAAAAAAAAAA';
const FIELD = {
  title: 'fldaaaaaaaaaaaaaaa',
  amount: 'fldbbbbbbbbbbbbbbb',
  formula: 'fldccccccccccccccc',
  link: 'fldddddddddddddddd',
  foreign: 'fldeeeeeeeeeeeeeee',
} as const;

const structure: ReproStructure = {
  tables: [
    {
      id: TABLE,
      name: 'Table_1',
      fields: [
        { id: FIELD.title, name: 'Field_1', type: 'singleLineText', isPrimary: true },
        { id: FIELD.amount, name: 'Field_2', type: 'number' },
        {
          id: FIELD.formula,
          name: 'Field_3',
          type: 'formula',
          options: { expression: `{${FIELD.amount}}*2` },
        },
        {
          id: FIELD.link,
          name: 'Field_4',
          type: 'link',
          options: { relationship: 'manyMany', foreignTableId: 'tblBBBBBBBBBBBBBBBB' },
        },
      ],
    },
  ],
};

describe('dead-letter payload parsing', () => {
  it('accepts the admin anomaly payload and a raw table row', () => {
    const adminPayload = {
      source: 'teable-admin:computed-outbox-anomaly',
      taskId: 'cuo123',
      baseId: 'bse123',
      seedTableId: TABLE,
      changeType: 'update',
      failureKind: 'computed_code_bug',
      lastError: 'error: cannot cast type boolean to double precision',
      steps: JSON.stringify([{ tableId: TABLE, fieldIds: [FIELD.formula], level: 1 }]),
    };
    const parsed = parseDeadLetterPayload(adminPayload);
    expect(parsed.taskId).toBe('cuo123');
    expect(parsed.changeType).toBe('update');
    expect(parsed.steps).toEqual([{ tableId: TABLE, fieldIds: [FIELD.formula], level: 1 }]);
    expect(parsed.failureKind).toBe('computed_code_bug');

    const rowPayload = parseDeadLetterPayload({
      id: 'cuo456',
      base_id: 'bse456',
      seed_table_id: TABLE,
      change_type: 'update',
      seed_record_ids: ['rec1'],
      steps: [{ tableId: TABLE, fieldIds: [FIELD.formula], level: 0 }],
      edges: [],
      attempts: 1,
      max_attempts: 1,
      last_error: 'boom',
      trace_data: {
        version: 1,
        failure: { kind: 'computed_code_bug', phase: 'execute_plan' },
        execution: {
          statement: { normalizedSql: 'update "x" set "y" = <number>' },
        },
      },
    });
    expect(rowPayload.taskId).toBe('cuo456');
    expect(rowPayload.seedRecordIds).toEqual(['rec1']);
    expect(rowPayload.failurePhase).toBe('execute_plan');
    expect(rowPayload.failedSql).toBe('update "x" set "y" = <number>');
  });
});

describe('trigger derivation', () => {
  const deadLetter: ReproDeadLetter = {
    taskId: 'cuo1',
    baseId: 'bse1',
    seedTableId: TABLE,
    seedRecordIds: ['rec1'],
    changeType: 'update',
    changedFieldIds: [],
    steps: [{ tableId: TABLE, fieldIds: [FIELD.formula], level: 0 }],
    edges: [],
    raw: {},
  };

  it('derives writable source fields from the computed target dependencies', () => {
    const trigger = deriveTrigger({ deadLetter, structure });
    expect(trigger.kind).toBe('record-update');
    expect(trigger.tableId).toBe(TABLE);
    expect(trigger.fieldIds).toEqual([FIELD.amount]);
    expect(trigger.reason).toContain('plan steps');
  });

  it('honours an explicit link-change kind and picks a table that has a link', () => {
    const trigger = deriveTrigger({ structure, kind: 'link-change' });
    expect(trigger.kind).toBe('link-change');
    expect(trigger.fieldIds).toEqual([FIELD.link]);
  });

  it('refuses a field-update without the original field payload', () => {
    expect(() => deriveTrigger({ deadLetter, structure, kind: 'field-update' })).toThrow(
      /--trigger-json/
    );
  });
});
