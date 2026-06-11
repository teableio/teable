import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import type { TableDataSafetyLimitConfig } from '../../domain/shared/TableDataSafetyLimits';
import { BaseId } from '../../domain/base/BaseId';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import { FieldName } from '../../domain/table/fields/FieldName';
import { RecordId } from '../../domain/table/records/RecordId';
import { Table } from '../../domain/table/Table';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import {
  RecordWriteOperationKind,
  type RecordWriteFieldValues,
  type RecordWritePluginContext,
} from '../../ports/RecordWritePlugin';
import type { ITableDataSafetyLimitPlugin } from '../../ports/TableDataSafetyLimitPlugin';
import {
  StaticTableDataSafetyLimitPlugin,
  TableDataSafetyLimitComposer,
} from './TableDataSafetyLimitComposer';
import { TableDataSafetyLimitRecordWritePlugin } from './TableDataSafetyLimitRecordWritePlugin';

const actorId = ActorId.create('system')._unsafeUnwrap();
const table = Table.builder()
  .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
  .withName(TableName.create('Record Limit')._unsafeUnwrap())
  .field()
  .singleLineText()
  .withName(FieldName.create('Title')._unsafeUnwrap())
  .primary()
  .done()
  .view()
  .defaultGrid()
  .done()
  .build()
  ._unsafeUnwrap();
const textFieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
const recordId = RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap();

const values = (entries: ReadonlyArray<readonly [string, unknown]> = []): RecordWriteFieldValues =>
  new Map(entries);

const createContext = (
  kind: RecordWriteOperationKind,
  payload: Record<string, unknown>,
  tableLimits: TableDataSafetyLimitConfig
): RecordWritePluginContext =>
  ({
    kind,
    executionContext: {
      actorId,
      config: { tableLimits },
    } satisfies IExecutionContext,
    table,
    payload,
    isTransactionBound: false,
  }) as unknown as RecordWritePluginContext;

const runPlugin = async (context: RecordWritePluginContext) => {
  const plugin = new TableDataSafetyLimitRecordWritePlugin();
  const preparedResult = await plugin.prepare(context);
  if (preparedResult.isErr()) return preparedResult;
  return plugin.guard(context, preparedResult.value);
};

describe('TableDataSafetyLimitRecordWritePlugin', () => {
  it('supports every record write operation except deleteMany', () => {
    const plugin = new TableDataSafetyLimitRecordWritePlugin();

    expect(plugin.supports(RecordWriteOperationKind.createOne)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.createMany)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.createStream)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.submit)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.duplicate)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.duplicateStream)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.updateOne)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.updateMany)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.importAppend)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.paste)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.deleteMany)).toBe(false);
  });

  it.each([
    [
      RecordWriteOperationKind.createOne,
      {
        fieldValues: values([[textFieldId.toString(), 'A']]),
        fieldKeyType: FieldKeyType.Name,
        typecast: false,
        source: { type: 'user' },
        recordCount: 1,
      },
    ],
    [
      RecordWriteOperationKind.createMany,
      {
        recordsFieldValues: [values(), values()],
        fieldKeyType: FieldKeyType.Name,
        typecast: false,
        recordCount: 2,
      },
    ],
    [
      RecordWriteOperationKind.createStream,
      {
        recordsFieldValues: [values(), values()],
        batchSize: 2,
        recordCount: 2,
      },
    ],
    [
      RecordWriteOperationKind.submit,
      {
        fieldValues: values([[textFieldId.toString(), 'A']]),
        fieldKeyType: FieldKeyType.Name,
        typecast: false,
        source: { type: 'form' },
        recordCount: 1,
      },
    ],
    [
      RecordWriteOperationKind.duplicate,
      {
        sourceRecordId: recordId,
        fieldValues: values([[textFieldId.toString(), 'A']]),
        recordCount: 1,
      },
    ],
    [
      RecordWriteOperationKind.duplicateStream,
      {
        sourceRecordIds: [recordId, recordId],
        recordsFieldValues: [values(), values()],
        batchSize: 2,
        recordCount: 2,
      },
    ],
    [
      RecordWriteOperationKind.importAppend,
      {
        sourceType: 'csv',
        sourceColumnMap: {},
        recordsFieldValues: [values(), values()],
        batchSize: 2,
        typecast: false,
        recordCount: 2,
      },
    ],
    [
      RecordWriteOperationKind.paste,
      {
        editableFieldIds: [textFieldId],
        updateRecordIds: [recordId],
        updateRecordsFieldValues: [values([[textFieldId.toString(), 'Updated']])],
        createRecordsFieldValues: [values([[textFieldId.toString(), 'Created']])],
        typecast: false,
        updateRecordCount: 1,
        createRecordCount: 1,
        recordCount: 2,
      },
    ],
    [
      RecordWriteOperationKind.updateOne,
      {
        recordId,
        fieldValues: values([[textFieldId.toString(), 'A']]),
        fieldKeyType: FieldKeyType.Name,
        typecast: false,
      },
    ],
    [
      RecordWriteOperationKind.updateMany,
      {
        variant: 'explicit',
        fieldKeyType: FieldKeyType.Name,
        typecast: false,
        recordUpdates: [
          { recordId, fieldValues: values([[textFieldId.toString(), 'A']]) },
          { recordId, fieldValues: values([[textFieldId.toString(), 'B']]) },
        ],
        recordCount: 2,
      },
    ],
  ] satisfies ReadonlyArray<readonly [RecordWriteOperationKind, Record<string, unknown>]>)(
    'allows %s at the configured records-per-mutation boundary',
    async (kind, payload) => {
      const result = await runPlugin(
        createContext(kind, payload, { recordValues: { maxRecordsPerMutation: 2 } })
      );

      expect(result.isOk()).toBe(true);
    }
  );

  it.each([
    [
      RecordWriteOperationKind.createMany,
      {
        recordsFieldValues: [values(), values(), values()],
        fieldKeyType: FieldKeyType.Name,
        typecast: false,
        recordCount: 3,
      },
    ],
    [
      RecordWriteOperationKind.duplicateStream,
      {
        sourceRecordIds: [recordId, recordId, recordId],
        recordsFieldValues: [values(), values(), values()],
        batchSize: 3,
        recordCount: 3,
      },
    ],
    [
      RecordWriteOperationKind.importAppend,
      {
        sourceType: 'csv',
        sourceColumnMap: {},
        recordsFieldValues: [values(), values(), values()],
        batchSize: 3,
        typecast: false,
        recordCount: 3,
      },
    ],
    [
      RecordWriteOperationKind.paste,
      {
        editableFieldIds: [textFieldId],
        updateRecordIds: [],
        updateRecordsFieldValues: [],
        createRecordsFieldValues: [values(), values(), values()],
        typecast: false,
        updateRecordCount: 0,
        createRecordCount: 3,
        recordCount: 3,
      },
    ],
  ] satisfies ReadonlyArray<readonly [RecordWriteOperationKind, Record<string, unknown>]>)(
    'rejects %s when record count exceeds the configured limit',
    async (kind, payload) => {
      const result = await runPlugin(
        createContext(kind, payload, { recordValues: { maxRecordsPerMutation: 2 } })
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('validation.limit.records_per_mutation_max');
    }
  );

  it('rejects oversized cell values', async () => {
    const result = await runPlugin(
      createContext(
        RecordWriteOperationKind.updateOne,
        {
          recordId,
          fieldValues: values([[textFieldId.toString(), 'oversized']]),
          fieldKeyType: FieldKeyType.Name,
          typecast: false,
        },
        { recordValues: { maxCellValueBytes: 4, maxRecordFieldsBytes: 1_000 } }
      )
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.cell_value_max_bytes');
  });

  it('rejects oversized serialized record field values', async () => {
    const result = await runPlugin(
      createContext(
        RecordWriteOperationKind.createMany,
        {
          recordsFieldValues: [values([[textFieldId.toString(), 'oversized-record']])],
          fieldKeyType: FieldKeyType.Name,
          typecast: false,
          recordCount: 1,
        },
        { recordValues: { maxCellValueBytes: 1_000, maxRecordFieldsBytes: 4 } }
      )
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.record_fields_max_bytes');
  });

  it('uses the strictest composed limit from multiple plugins', async () => {
    const plugins: ITableDataSafetyLimitPlugin[] = [
      new StaticTableDataSafetyLimitPlugin({
        recordValues: { maxRecordsPerMutation: 10 },
      }),
      new StaticTableDataSafetyLimitPlugin({
        recordValues: { maxRecordsPerMutation: 2 },
      }),
    ];
    const plugin = new TableDataSafetyLimitRecordWritePlugin(
      new TableDataSafetyLimitComposer(plugins)
    );
    const context = createContext(
      RecordWriteOperationKind.createMany,
      {
        recordsFieldValues: [values(), values(), values()],
        fieldKeyType: FieldKeyType.Name,
        typecast: false,
        recordCount: 3,
      },
      {}
    );

    const preparedResult = await plugin.prepare(context);
    expect(preparedResult.isOk()).toBe(true);
    if (preparedResult.isErr()) return;

    const result = plugin.guard(context, preparedResult.value);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.records_per_mutation_max');
  });
});
