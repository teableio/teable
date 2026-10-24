import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { MultipleSelectField } from '../../domain/table/fields/types/MultipleSelectField';
import { SelectOption } from '../../domain/table/fields/types/SelectOption';
import type { SingleSelectField } from '../../domain/table/fields/types/SingleSelectField';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import {
  preLeasePlan,
  sharedRecordWritePlan,
  exclusiveRecordWritePlan,
} from './RecordWriteCoordinationPlan';
import { RecordWriteSideEffectService } from './RecordWriteSideEffectService';
import { withRecordWriteCoordination } from './withRecordWriteCoordination';

const createSelectOption = (name: string, color = 'blue') =>
  SelectOption.create({ name, color })._unsafeUnwrap();

const buildTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Select Auto Create')._unsafeUnwrap();
  const titleFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
  const singleSelectFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  const multiSelectFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);

  builder
    .field()
    .singleLineText()
    .withId(titleFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();

  builder
    .field()
    .singleSelect()
    .withId(singleSelectFieldId)
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([createSelectOption('Open')])
    .done();

  builder
    .field()
    .multipleSelect()
    .withId(multiSelectFieldId)
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withOptions([createSelectOption('Tag A'), createSelectOption('Tag B')])
    .done();

  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    titleFieldId,
    singleSelectFieldId,
    multiSelectFieldId,
  };
};

const contextWithLimits = (
  maxSelectChoices: number,
  maxNameLength?: number
): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
  config: {
    tableLimits: {
      fieldOptions: {
        maxSelectChoices,
        ...(maxNameLength != null ? { maxSelectChoiceNameLength: maxNameLength } : {}),
      },
    },
  },
});

describe('RecordWriteSideEffectService', () => {
  const service = new RecordWriteSideEffectService();

  it.each([
    { ordered: true, exclusive: false, reads: 1, events: ['load', 'execute'] },
    {
      ordered: false,
      exclusive: false,
      reads: 1,
      events: ['shared', 'load', 'execute', 'release-shared'],
    },
    {
      ordered: false,
      exclusive: true,
      reads: 2,
      events: [
        'shared',
        'load',
        'release-shared',
        'exclusive',
        'load',
        'execute',
        'release-exclusive',
      ],
    },
  ])(
    'coordinates reads and release order for $ordered/$exclusive',
    async ({ ordered, exclusive, reads, events }) => {
      const { table } = buildTable();
      const actual: string[] = [];
      let readCount = 0;
      const result = await withRecordWriteCoordination({
        context: contextWithLimits(10),
        tableId: table.id(),
        initialPlan: preLeasePlan({ hasOrder: ordered }),
        coordination: {
          acquire: async (_context, tableIds, mode) => {
            actual.push(mode);
            return ok({
              mode,
              tableIds,
              release: async () => {
                actual.push(`release-${mode}`);
              },
            });
          },
        },
        loadTable: async () => {
          readCount++;
          actual.push('load');
          return ok(table);
        },
        planForTable: () => (exclusive ? exclusiveRecordWritePlan : sharedRecordWritePlan),
        execute: async () => {
          actual.push('execute');
          return ok('written');
        },
      });
      expect(result._unsafeUnwrap()).toBe('written');
      expect(readCount).toBe(reads);
      expect(actual).toEqual(events);
    }
  );

  it.each([
    { typecast: false, value: 'Closed', expected: false },
    { typecast: true, value: 'Open', expected: false },
    { typecast: true, value: 'Closed', expected: true },
  ])(
    'selects exclusive coverage only for accepted metadata writes: $value/$typecast',
    ({ typecast, value, expected }) => {
      const { table } = buildTable();
      const fieldValues = new Map<string, unknown>([['Status', value]]);
      expect(
        service.planCoordination(contextWithLimits(10), table, {
          hasOrder: false,
          fieldValues,
          fieldKeyType: FieldKeyType.Name,
          typecast,
        }).mode
      ).toBe(expected ? 'exclusive' : 'shared');
      expect(fieldValues.get('Status')).toBe(value);
    }
  );

  it('keeps empty input, resolution errors and preparation errors on the single-record shared path', () => {
    const { table } = buildTable();
    for (const fieldValues of [
      new Map<string, unknown>(),
      new Map<string, unknown>([['Unknown', 'value']]),
      new Map<string, unknown>([['Status', 'Closed']]),
    ]) {
      expect(
        service.planCoordination(contextWithLimits(1), table, {
          hasOrder: false,
          fieldValues,
          fieldKeyType: FieldKeyType.Name,
          typecast: true,
        }).mode
      ).toBe('shared');
    }
  });

  it('plans ordered writes without a lease even when they would add metadata', () => {
    const { table } = buildTable();
    expect(
      service.planCoordination(contextWithLimits(10), table, {
        hasOrder: true,
        fieldValues: new Map([['Status', 'Closed']]),
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
      })
    ).toEqual({ mode: 'none', reason: 'ordered', requiresFreshTable: false });
  });

  it('prepares execution field values without changing the input keys', () => {
    const { table, singleSelectFieldId } = buildTable();
    const fieldValues = new Map<string, unknown>([['Status', 'Open']]);
    const prepared = service
      .prepareFieldValues(table, fieldValues, FieldKeyType.Name)
      ._unsafeUnwrap();
    expect(prepared.get(singleSelectFieldId.toString())).toBe('Open');
    expect(fieldValues.has('Status')).toBe(true);
  });

  it('prepares the updated table and undo plan together without changing capture ordering', async () => {
    const { table, singleSelectFieldId } = buildTable();
    const context = contextWithLimits(10);
    const undoRedoPlan = { undoCommands: [], redoCommands: [] };
    let captured = false;
    const result = await service.prepareUpdate(
      context,
      table,
      new Map([[singleSelectFieldId.toString(), 'Closed']]),
      true,
      {
        captureSelectOptionSideEffects: async (actualContext, before, after, effects) => {
          expect(actualContext).toBe(context);
          expect(before).toBe(table);
          expect(after).not.toBe(table);
          expect(effects).toHaveLength(1);
          captured = true;
          return ok(undoRedoPlan);
        },
      }
    );
    expect(captured).toBe(true);
    expect(result._unsafeUnwrap().undoRedoPlan).toBe(undoRedoPlan);
    expect(result._unsafeUnwrap().updateResult).toBeDefined();
  });

  it('fails the write when the only cell would create an option over the cap', () => {
    const { table, singleSelectFieldId } = buildTable();
    const records = [new Map<string, unknown>([[singleSelectFieldId.toString(), 'In Progress']])];

    const result = service.execute(contextWithLimits(1), table, records, true);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.field.select_options_limit');
  });

  it('keeps other fields and skips the overflowing select cell', () => {
    const { table, titleFieldId, singleSelectFieldId } = buildTable();
    const records = [
      new Map<string, unknown>([
        [titleFieldId.toString(), 'Kept Title'],
        [singleSelectFieldId.toString(), 'In Progress'],
      ]),
    ];

    const result = service.execute(contextWithLimits(1), table, records, true)._unsafeUnwrap();

    expect(result.effects).toHaveLength(0);
    expect(result.updateResult).toBeUndefined();
    expect(records[0]?.get(titleFieldId.toString())).toBe('Kept Title');
    expect(records[0]?.has(singleSelectFieldId.toString())).toBe(false);
  });

  it('creates options up to the remaining cap and skips later names', () => {
    const { table, singleSelectFieldId } = buildTable();
    const records = [
      new Map<string, unknown>([[singleSelectFieldId.toString(), 'First']]),
      new Map<string, unknown>([[singleSelectFieldId.toString(), 'Second']]),
    ];

    const result = service.execute(contextWithLimits(2), table, records, true)._unsafeUnwrap();

    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]?.options.map((option) => option.name().toString())).toEqual(['First']);
    expect(records[0]?.get(singleSelectFieldId.toString())).toBe('First');
    expect(records[1]?.has(singleSelectFieldId.toString())).toBe(false);

    const updatedField = result.table
      .getField((field) => field.id().equals(singleSelectFieldId))
      ._unsafeUnwrap() as SingleSelectField;
    expect(updatedField.selectOptions().map((option) => option.name().toString())).toEqual([
      'Open',
      'First',
    ]);
  });

  it('keeps existing multi-select values when a new name does not fit', () => {
    const { table, multiSelectFieldId } = buildTable();
    const records = [
      new Map<string, unknown>([[multiSelectFieldId.toString(), ['Tag A', 'Tag C']]]),
    ];

    const result = service.execute(contextWithLimits(2), table, records, true)._unsafeUnwrap();

    expect(result.effects).toHaveLength(0);
    expect(records[0]?.get(multiSelectFieldId.toString())).toEqual(['Tag A']);

    const updatedField = result.table
      .getField((field) => field.id().equals(multiSelectFieldId))
      ._unsafeUnwrap() as MultipleSelectField;
    expect(updatedField.selectOptions().map((option) => option.name().toString())).toEqual([
      'Tag A',
      'Tag B',
    ]);
  });

  it('skips option names that exceed the configured length when other cells remain', () => {
    const { table, titleFieldId, singleSelectFieldId } = buildTable();
    const records = [
      new Map<string, unknown>([
        [titleFieldId.toString(), 'Kept Title'],
        [singleSelectFieldId.toString(), 'A'.repeat(101)],
      ]),
    ];

    const result = service
      .execute(contextWithLimits(1000, 100), table, records, true)
      ._unsafeUnwrap();

    expect(result.effects).toHaveLength(0);
    expect(records[0]?.get(titleFieldId.toString())).toBe('Kept Title');
    expect(records[0]?.has(singleSelectFieldId.toString())).toBe(false);
  });
});
