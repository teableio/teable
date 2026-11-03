import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../../base/BaseId';
import type { DomainError } from '../../shared/DomainError';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { DateDefaultValue } from '../fields/types/DateDefaultValue';
import { DateTimeFormatting } from '../fields/types/DateTimeFormatting';
import { FieldNotNull } from '../fields/types/FieldNotNull';
import type { UpdateRecordItem } from '../methods/records/updateRecordsStream';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { RecordId } from './RecordId';
import { recordToFieldValues } from './recordToFieldValues';
import { TableRecord } from './TableRecord';

const utcDateFormatting = DateTimeFormatting.create({
  date: 'YYYY-MM-DD',
  time: 'None',
  timeZone: 'utc',
})._unsafeUnwrap();

const createFieldId = (seed: string): FieldId =>
  FieldId.create(`fld${seed.replaceAll('-', '').padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();

const createFieldName = (name: string): FieldName => FieldName.create(name)._unsafeUnwrap();

const createRecordId = (seed: string): RecordId =>
  RecordId.create(`rec${seed.replaceAll('-', '').padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();

type FieldDefinition =
  | { type: 'text'; id: FieldId; name: string; primary?: boolean }
  | { type: 'number'; id: FieldId; name: string; notNull?: boolean }
  | { type: 'date'; id: FieldId; name: string; defaultNow?: boolean };

const buildTable = (seed: string, fieldDefinitions: ReadonlyArray<FieldDefinition>): Table => {
  const identity = seed.replaceAll('-', '').padEnd(16, '0').slice(0, 16);
  const builder = Table.builder()
    .withId(TableId.create(`tbl${identity}`)._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${identity}`)._unsafeUnwrap())
    .withName(TableName.create(`Bulk ${seed}`)._unsafeUnwrap());

  for (const definition of fieldDefinitions) {
    switch (definition.type) {
      case 'text': {
        const textFieldBuilder = builder
          .field()
          .singleLineText()
          .withId(definition.id)
          .withName(createFieldName(definition.name));
        if (definition.primary) textFieldBuilder.primary();
        textFieldBuilder.done();
        break;
      }
      case 'number': {
        const numberFieldBuilder = builder
          .field()
          .number()
          .withId(definition.id)
          .withName(createFieldName(definition.name));
        if (definition.notNull) numberFieldBuilder.withNotNull(FieldNotNull.required());
        numberFieldBuilder.done();
        break;
      }
      case 'date': {
        const dateFieldBuilder = builder
          .field()
          .date()
          .withId(definition.id)
          .withName(createFieldName(definition.name))
          .withFormatting(utcDateFormatting);
        if (definition.defaultNow) {
          dateFieldBuilder.withDefaultValue(DateDefaultValue.create('now')._unsafeUnwrap());
        }
        dateFieldBuilder.done();
        break;
      }
    }
  }

  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  table.pullDomainEvents();
  return table;
};

/** Runs `run` on a controlled clock and always restores the real timers. */
const withFakeClock = async (run: () => Promise<void> | void): Promise<void> => {
  vi.useFakeTimers();
  try {
    await run();
  } finally {
    vi.useRealTimers();
  }
};

const batchOf = <T>(
  results: ReadonlyArray<Result<ReadonlyArray<T>, DomainError>>,
  index: number
): ReadonlyArray<T> => {
  const batch = results[index];
  if (!batch) throw new Error(`expected a batch at index ${index}`);
  if (batch.isErr()) throw new Error(`expected a success batch at index ${index}`);
  return batch.value;
};

describe('record stream creation', () => {
  it('evaluates date now per record within and across sync stream batches', async () => {
    await withFakeClock(() => {
      const titleFieldId = createFieldId('stream-title');
      const dueFieldId = createFieldId('stream-due');
      const table = buildTable('stream-sync', [
        { type: 'text', id: titleFieldId, name: 'Title', primary: true },
        { type: 'date', id: dueFieldId, name: 'Due', defaultNow: true },
      ]);

      const firstNow = '2026-01-02T03:04:05.000Z';
      const secondNow = '2026-02-03T04:05:06.000Z';
      const thirdNow = '2026-03-04T05:06:07.000Z';

      function* rows() {
        vi.setSystemTime(new Date(firstNow));
        for (let index = 0; index < 100; index++) {
          if (index === 50) vi.setSystemTime(new Date(secondNow));
          yield new Map<string, unknown>([['Title', `row-${index}`]]);
        }
        vi.setSystemTime(new Date(thirdNow));
        yield new Map<string, unknown>([['Title', 'row-100']]);
      }

      // batchSize 100 is the documented floor, so 101 rows produce 100 + 1.
      const results = [...table.createRecordsStream(rows(), { batchSize: 100 })];
      expect(results).toHaveLength(2);

      const firstBatch = batchOf(results, 0);
      const secondBatch = batchOf(results, 1);
      expect(firstBatch).toHaveLength(100);
      expect(secondBatch).toHaveLength(1);

      expect(firstBatch[0]?.fields().get(titleFieldId)?.toValue()).toBe('row-0');
      expect(firstBatch[99]?.fields().get(titleFieldId)?.toValue()).toBe('row-99');
      const dueDates = firstBatch.map((record) => record.fields().get(dueFieldId)?.toValue());
      expect(dueDates).toEqual(
        Array.from({ length: 100 }, (_, index) => (index < 50 ? firstNow : secondNow))
      );

      const [tail] = secondBatch;
      if (!tail) throw new Error('expected the trailing batch record');
      expect(tail.fields().get(titleFieldId)?.toValue()).toBe('row-100');
      expect(tail.fields().get(dueFieldId)?.toValue()).toBe(thirdNow);
    });
  });

  it('evaluates the date now default per async record and lets explicit dates override it', async () => {
    await withFakeClock(async () => {
      const titleFieldId = createFieldId('async-title');
      const dueFieldId = createFieldId('async-due');
      const table = buildTable('stream-async', [
        { type: 'text', id: titleFieldId, name: 'Title', primary: true },
        { type: 'date', id: dueFieldId, name: 'Due', defaultNow: true },
      ]);

      const firstNow = '2026-03-04T05:06:07.000Z';
      const secondNow = '2026-04-05T06:07:08.000Z';
      const thirdNow = '2026-05-06T07:08:09.000Z';

      async function* rows() {
        vi.setSystemTime(new Date(firstNow));
        yield new Map<string, unknown>([['Title', 'alpha']]);
        await Promise.resolve();
        vi.setSystemTime(new Date(secondNow));
        yield new Map<string, unknown>([['Title', 'beta']]);
        yield new Map<string, unknown>([
          ['Title', 'cleared'],
          ['Due', null],
        ]);
        await Promise.resolve();
        vi.setSystemTime(new Date(thirdNow));
        yield new Map<string, unknown>([
          ['Title', 'gamma'],
          ['Due', '2024-01-15'],
        ]);
      }

      const results: Array<Result<ReadonlyArray<TableRecord>, DomainError>> = [];
      for await (const batch of table.createRecordsStreamAsync(rows())) {
        results.push(batch);
      }
      expect(results).toHaveLength(1);

      const batch = batchOf(results, 0);
      expect(batch).toHaveLength(4);
      const dueDates = batch.map((record) => record.fields().get(dueFieldId)?.toValue() ?? null);
      expect(dueDates).toEqual([firstNow, secondNow, null, '2024-01-15T00:00:00.000Z']);
      const titles = batch.map((record) => record.fields().get(titleFieldId)?.toValue());
      expect(titles).toEqual(['alpha', 'beta', 'cleared', 'gamma']);
    });
  });

  it('stops the async stream at the first bad row after emitting the batches built before it', async () => {
    const titleFieldId = createFieldId('stop-title');
    const table = buildTable('stream-stop', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
    ]);

    let consumed = 0;
    async function* rows() {
      for (let index = 0; index < 100; index++) {
        consumed += 1;
        yield new Map<string, unknown>([['Title', `row-${index}`]]);
      }
      consumed += 1;
      yield new Map<string, unknown>([['Missing', 'bad-row']]);
      consumed += 1;
      yield new Map<string, unknown>([['Title', 'never-built']]);
    }

    const results: Array<Result<ReadonlyArray<TableRecord>, DomainError>> = [];
    for await (const batch of table.createRecordsStreamAsync(rows(), { batchSize: 100 })) {
      results.push(batch);
    }

    // The first batch was already handed to the caller before the bad row was read; this
    // stream makes no rollback claim about batches it has yielded.
    expect(results).toHaveLength(2);
    const firstBatch = batchOf(results, 0);
    expect(firstBatch).toHaveLength(100);
    const titles = firstBatch.map((record) => record.fields().get(titleFieldId)?.toValue());
    expect(titles).toEqual(Array.from({ length: 100 }, (_, index) => `row-${index}`));

    const failed = results[1];
    if (!failed) throw new Error('expected the failing batch result');
    expect(failed._unsafeUnwrapErr()).toMatchObject({ code: 'field.not_found' });
    expect(consumed).toBe(101);
  });
});

describe('record stream updates', () => {
  it('assigns only provided values and treats undefined as a skip, null as a clear and omission as untouched', () => {
    const titleFieldId = createFieldId('update-title');
    const countFieldId = createFieldId('update-count');
    const dueFieldId = createFieldId('update-due');
    const table = buildTable('update-values', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
      { type: 'number', id: countFieldId, name: 'Count' },
      { type: 'date', id: dueFieldId, name: 'Due' },
    ]);

    const renamedId = createRecordId('update-a');
    const clearedId = createRecordId('update-b');
    const datedId = createRecordId('update-c');

    const renamedValues = new Map<string, unknown>([
      ['Title', 'renamed'],
      ['Count', undefined],
    ]);
    const clearedValues = new Map<string, unknown>([['Count', null]]);
    const datedValues = new Map<string, unknown>([['Due', '2024-01-15']]);

    const updates: UpdateRecordItem[] = [
      { recordId: renamedId, fieldValues: renamedValues },
      { recordId: clearedId, fieldValues: clearedValues },
      { recordId: datedId, fieldValues: datedValues },
    ];

    const results = [...table.updateRecordsStream(updates)];
    expect(results).toHaveLength(1);

    const batch = batchOf(results, 0);
    const updatedIds = batch.map((result) => result.record.id().toString());
    expect(updatedIds).toEqual([renamedId.toString(), clearedId.toString(), datedId.toString()]);

    const [renamed, cleared, dated] = batch;
    if (!renamed || !cleared || !dated) throw new Error('expected three update results');

    // Present but undefined skips the cell; the alias mapping still records the key.
    expect(recordToFieldValues(renamed.record)).toEqual([
      { fieldId: titleFieldId.toString(), value: 'renamed' },
    ]);
    expect(renamed.record.fields().get(countFieldId)).toBeUndefined();
    const renamedMapping = [...renamed.fieldKeyMapping];
    expect(renamedMapping).toEqual([
      [titleFieldId.toString(), 'Title'],
      [countFieldId.toString(), 'Count'],
    ]);

    // Explicit null clears the cell instead of skipping it.
    expect(recordToFieldValues(cleared.record)).toEqual([
      { fieldId: countFieldId.toString(), value: null },
    ]);

    // An omitted optional field contributes no cell at all.
    expect(recordToFieldValues(dated.record)).toEqual([
      { fieldId: dueFieldId.toString(), value: '2024-01-15T00:00:00.000Z' },
    ]);
    expect(dated.record.fields().get(countFieldId)).toBeUndefined();
    expect(dated.record.fields().get(titleFieldId)).toBeUndefined();
  });

  it('rejects an invalid aliased value in strict mode and stores it when typecast is on', () => {
    const titleFieldId = createFieldId('typecast-title');
    const scoreFieldId = createFieldId('typecast-score');
    const table = buildTable('update-typecast', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
      { type: 'number', id: scoreFieldId, name: 'Score' },
    ]);
    const recordId = createRecordId('typecast-record');

    const aliasValues = new Map<string, unknown>([['Score', '1,234']]);
    const updateItems = [{ recordId, fieldValues: aliasValues }];

    const strictResults = [...table.updateRecordsStream(updateItems)];
    const strictFailed = strictResults[0];
    if (!strictFailed) throw new Error('expected one strict result');
    expect(strictFailed._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.field.invalid_value',
      details: { fieldId: scoreFieldId.toString() },
    });

    const castResults = [...table.updateRecordsStream(updateItems, { typecast: true })];
    const castBatch = batchOf(castResults, 0);
    const [castResult] = castBatch;
    if (!castResult) throw new Error('expected one typecast result');
    expect(recordToFieldValues(castResult.record)).toEqual([
      { fieldId: scoreFieldId.toString(), value: 1234 },
    ]);
    expect([...castResult.fieldKeyMapping]).toEqual([[scoreFieldId.toString(), 'Score']]);
  });

  it('stops on the first failing update after yielding the batch collected before it', () => {
    const titleFieldId = createFieldId('stop-title-update');
    const table = buildTable('update-stop', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
    ]);

    const recordIdAt = (index: number) => createRecordId(`stop-${index}`);

    let consumed = 0;
    function* updates(): Generator<UpdateRecordItem> {
      for (let index = 0; index < 100; index++) {
        consumed += 1;
        yield {
          recordId: recordIdAt(index),
          fieldValues: new Map<string, unknown>([['Title', `row-${index}`]]),
        };
      }
      consumed += 1;
      yield {
        recordId: recordIdAt(100),
        fieldValues: new Map<string, unknown>([['Missing', 'bad-row']]),
      };
      consumed += 1;
      yield {
        recordId: recordIdAt(101),
        fieldValues: new Map<string, unknown>([['Title', 'never-built']]),
      };
    }

    const results = [...table.updateRecordsStream(updates(), { batchSize: 100 })];
    expect(results).toHaveLength(2);

    const firstBatch = batchOf(results, 0);
    expect(firstBatch).toHaveLength(100);
    expect(firstBatch[0]?.record.id().toString()).toBe(recordIdAt(0).toString());
    expect(firstBatch[99]?.record.id().toString()).toBe(recordIdAt(99).toString());

    const failed = results[1];
    if (!failed) throw new Error('expected the failing batch result');
    expect(failed._unsafeUnwrapErr()).toMatchObject({ code: 'field.not_found' });
    expect(consumed).toBe(101);
  });

  it('replays the returned mutation spec onto the stored record without touching it', () => {
    const titleFieldId = createFieldId('replay-title');
    const countFieldId = createFieldId('replay-count');
    const dueFieldId = createFieldId('replay-due');
    const table = buildTable('update-replay', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
      { type: 'number', id: countFieldId, name: 'Count' },
      { type: 'date', id: dueFieldId, name: 'Due' },
    ]);

    const stored = TableRecord.fromRawFieldValues({
      id: createRecordId('replay-record').toString(),
      tableId: table.id(),
      fields: {
        [titleFieldId.toString()]: 'stored',
        [countFieldId.toString()]: 3,
        [dueFieldId.toString()]: '2024-02-03T00:00:00.000Z',
      },
    })._unsafeUnwrap();

    const assignedValues = new Map<string, unknown>([
      ['Title', 'assigned'],
      ['Count', undefined],
      ['Due', null],
    ]);
    const updates = [{ recordId: stored.id(), fieldValues: assignedValues }];
    const results = [...table.updateRecordsStream(updates)];

    const batch = batchOf(results, 0);
    const [updateResult] = batch;
    if (!updateResult) throw new Error('expected one update result');

    // The update result carries assigned cells only, never the stored cells it did not touch.
    expect(recordToFieldValues(updateResult.record)).toEqual([
      { fieldId: titleFieldId.toString(), value: 'assigned' },
      { fieldId: dueFieldId.toString(), value: null },
    ]);

    const replayed = updateResult.mutateSpec.mutate(stored)._unsafeUnwrap();
    expect(recordToFieldValues(replayed)).toEqual([
      { fieldId: titleFieldId.toString(), value: 'assigned' },
      { fieldId: countFieldId.toString(), value: 3 },
      { fieldId: dueFieldId.toString(), value: null },
    ]);
    expect(replayed.fields().get(titleFieldId)?.toValue()).toBe(
      updateResult.record.fields().get(titleFieldId)?.toValue()
    );
    expect(replayed.fields().get(dueFieldId)?.toValue()).toBe(
      updateResult.record.fields().get(dueFieldId)?.toValue()
    );

    expect(recordToFieldValues(stored)).toEqual([
      { fieldId: titleFieldId.toString(), value: 'stored' },
      { fieldId: countFieldId.toString(), value: 3 },
      { fieldId: dueFieldId.toString(), value: '2024-02-03T00:00:00.000Z' },
    ]);
  });
});

describe('validated record creation', () => {
  it('keeps restored raw values and fills defaults while the strict path normalizes and requires them', async () => {
    await withFakeClock(() => {
      const titleFieldId = createFieldId('validated-title');
      const amountFieldId = createFieldId('validated-amount');
      const dueFieldId = createFieldId('validated-due');
      const table = buildTable('create-validated', [
        { type: 'text', id: titleFieldId, name: 'Title', primary: true },
        { type: 'number', id: amountFieldId, name: 'Amount', notNull: true },
        { type: 'date', id: dueFieldId, name: 'Due', defaultNow: true },
      ]);

      const now = '2026-06-07T08:09:10.000Z';
      vi.setSystemTime(new Date(now));

      const rawValues = new Map<string, unknown>([['Title', '  raw\ttext  ']]);

      // Default (API) path: the missing not-null field is rejected before any write.
      const strictFailure = table.createRecords([rawValues]);
      expect(strictFailure._unsafeUnwrapErr()).toMatchObject({
        code: 'validation.field.not_null',
        details: { fieldId: amountFieldId.toString() },
      });

      // Restore/duplicate path: pre-validated values skip that rule and schema normalization.
      const typedValues = new Map<string, unknown>([
        ['Title', 'ok'],
        ['Amount', 5],
      ]);
      const restored = table.createRecords([rawValues, typedValues], { valuesAreValidated: true });
      const restoredRecords = restored._unsafeUnwrap().records;
      expect(restoredRecords).toHaveLength(2);

      const [raw, typed] = restoredRecords;
      if (!raw || !typed) throw new Error('expected two created records');
      expect(recordToFieldValues(raw)).toEqual([
        { fieldId: titleFieldId.toString(), value: '  raw\ttext  ' },
        { fieldId: dueFieldId.toString(), value: now },
      ]);
      expect(raw.fields().get(amountFieldId)).toBeUndefined();
      expect(recordToFieldValues(typed)).toEqual([
        { fieldId: titleFieldId.toString(), value: 'ok' },
        { fieldId: amountFieldId.toString(), value: 5 },
        { fieldId: dueFieldId.toString(), value: now },
      ]);

      // The same text through the strict path is normalized.
      const normalizedValues = new Map<string, unknown>([
        ['Title', '  raw\ttext  '],
        ['Amount', 5],
      ]);
      const normalized = table.createRecords([normalizedValues]);
      expect(normalized._unsafeUnwrap().records[0]?.fields().get(titleFieldId)?.toValue()).toBe(
        'raw text'
      );
    });
  });
});
