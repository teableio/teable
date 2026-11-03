import {
  ActorId,
  BaseId,
  FieldId,
  FieldName,
  RecordId,
  Table,
  TableId,
  TableName,
  type BulkRecordPreparationService,
  type DeleteByRangeApplicationService,
  type IExecutionContext,
  type IReadOnlyBulkRecordPolicy,
  type TableQueryService,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BulkDeletePreviewPlanner, parseBulkDeletePreviewInput } from './BulkDeletePreviewPlanner';
import { BulkUpdatePreviewPlanner, parseBulkUpdatePreviewInput } from './BulkUpdatePreviewPlanner';

const buildTable = () => {
  const tableId = TableId.create(`tbl${'t'.repeat(16)}`)._unsafeUnwrap();
  const fieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Bulk preview')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(fieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  return { table, tableId, fieldId, viewId: table.views()[0].id().toString() };
};

const context: IExecutionContext = { actorId: ActorId.create('system')._unsafeUnwrap() };

const tableQuery = (table: Table) =>
  ({ getById: vi.fn(async () => ok(table)) }) as unknown as TableQueryService;

describe('bulk operation preview planners', () => {
  it('keeps plugin authorization and affected rows unknown without invoking write hooks', async () => {
    const { table, tableId, fieldId } = buildTable();
    const update = vi.fn(async () =>
      ok({
        requestedCount: 2,
        loadedCount: 1,
        selectedCount: 1,
        authorizedCount: null,
        acceptedCount: null,
        missingCount: 1,
        pluginFilteredCount: null,
        affectedCount: null,
        schemaEffects: [],
        policyChecked: false,
      })
    );
    const planner = new BulkUpdatePreviewPlanner(tableQuery(table), {
      update,
    } as unknown as BulkRecordPreparationService);
    const command = parseBulkUpdatePreviewInput({
      tableId: tableId.toString(),
      recordIds: [`rec${'a'.repeat(16)}`, `rec${'b'.repeat(16)}`],
      fields: { [fieldId.toString()]: 'Updated' },
      fieldKeyType: 'id',
    })._unsafeUnwrap();

    const result = await planner.preview(context, command, {
      detail: 'full',
      includeComplexity: false,
      maxItems: 100,
    });

    expect(result._unsafeUnwrap().effects[0].measures).toMatchObject({
      selectedRows: { basis: 'exact', value: 1 },
      authorizedRows: { basis: 'unknown' },
      affectedRows: { basis: 'unknown' },
    });
    expect(result._unsafeUnwrap().coverage.unknown).toContain('record-write-plugin-policy');
    expect(result._unsafeUnwrap().warnings.map((warning) => warning.code)).toContain(
      'records.bulkUpdate.requested_rows_missing'
    );
    expect(update).toHaveBeenCalledOnce();
    expect(result._unsafeUnwrap().complexityProjection).toMatchObject({
      operation: {
        kind: 'update',
        tableId: tableId.toString(),
        changedFieldIds: [fieldId.toString()],
      },
      coverage: {
        unknown: ['complexity-planner-projection', 'complexity-selection'],
      },
    });
  });

  it('blocks explicitly requested plugin-filtered updates and reports typecast schema effects', async () => {
    const { table, tableId, fieldId } = buildTable();
    const prepare = vi.fn(async () => ok({}));
    const policy = { prepare } as IReadOnlyBulkRecordPolicy;
    const preparation = {
      update: vi.fn(async () =>
        ok({
          requestedCount: 2,
          loadedCount: 2,
          selectedCount: 2,
          authorizedCount: 1,
          acceptedCount: 1,
          missingCount: 0,
          pluginFilteredCount: 1,
          affectedCount: null,
          schemaEffects: [
            {
              fieldId,
              options: [{ name: () => ({ toString: () => 'New' }) }],
            },
          ],
          policyChecked: true,
        })
      ),
    } as unknown as BulkRecordPreparationService;
    const planner = new BulkUpdatePreviewPlanner(tableQuery(table), preparation, policy);
    const command = parseBulkUpdatePreviewInput({
      tableId: tableId.toString(),
      records: [
        { id: `rec${'a'.repeat(16)}`, fields: { [fieldId.toString()]: 'A' } },
        { id: `rec${'b'.repeat(16)}`, fields: { [fieldId.toString()]: 'B' } },
      ],
      typecast: true,
      fieldKeyType: 'id',
    })._unsafeUnwrap();

    const result = await planner.preview(context, command, {
      detail: 'summary',
      includeComplexity: false,
      maxItems: 100,
    });

    expect(result._unsafeUnwrap().blockers).toEqual([
      expect.objectContaining({ code: 'records.bulkUpdate.requested_rows_forbidden' }),
    ]);
    expect(result._unsafeUnwrap().effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'records.bulkUpdate.select_options_create' }),
      ])
    );
    expect(prepare).toHaveBeenCalledOnce();
  });

  it('maps the real range delete contract and never invokes delete persistence', async () => {
    const { table, tableId, viewId } = buildTable();
    const selectedId = RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap();
    const prepareDelete = vi.fn(async () =>
      ok({
        table,
        recordIds: [selectedId],
        deletedRecordIds: [selectedId.toString()],
        recordSnapshots: [],
      })
    );
    const deletePreparation = vi.fn(async () =>
      ok({
        requestedCount: 1,
        loadedCount: 1,
        selectedCount: 1,
        authorizedCount: null,
        acceptedCount: null,
        missingCount: 0,
        pluginFilteredCount: null,
        affectedCount: null,
        schemaEffects: [],
        policyChecked: false,
      })
    );
    const planner = new BulkDeletePreviewPlanner(
      tableQuery(table),
      { prepareDelete } as unknown as DeleteByRangeApplicationService,
      { delete: deletePreparation } as unknown as BulkRecordPreparationService
    );
    const command = parseBulkDeletePreviewInput({
      tableId: tableId.toString(),
      viewId,
      ranges: [[0, 0]],
      type: 'rows',
      filter: { fieldId: `fld${'f'.repeat(16)}`, operator: 'is', value: 'A' },
    })._unsafeUnwrap();

    const result = await planner.preview(context, command, {
      detail: 'full',
      includeComplexity: false,
      maxItems: 100,
    });

    expect(result._unsafeUnwrap().effects[0].measures).toMatchObject({
      selectedRows: { basis: 'exact', value: 1 },
      authorizedRows: { basis: 'unknown' },
    });
    expect(result._unsafeUnwrap().coverage.known).toContain(
      'view-filter-search-sort-range-selection'
    );
    expect(prepareDelete).toHaveBeenCalledOnce();
    expect(result._unsafeUnwrap().complexityProjection).toMatchObject({
      operation: {
        kind: 'delete',
        tableId: tableId.toString(),
        changedFieldIds: [],
      },
      coverage: {
        unknown: ['complexity-planner-projection', 'complexity-selection'],
      },
    });
    expect(deletePreparation).not.toHaveBeenCalled();
  });

  it('blocks forbidden explicit deletes and reports missing ids separately', async () => {
    const { table, tableId } = buildTable();
    const prepare = vi.fn(async () => ok({}));
    const deletePreparation = vi.fn(async () =>
      ok({
        requestedCount: 3,
        loadedCount: 2,
        selectedCount: 2,
        authorizedCount: 1,
        acceptedCount: 1,
        missingCount: 1,
        pluginFilteredCount: 1,
        affectedCount: 1,
        schemaEffects: [],
        policyChecked: true,
      })
    );
    const planner = new BulkDeletePreviewPlanner(
      tableQuery(table),
      { prepareDelete: vi.fn() } as unknown as DeleteByRangeApplicationService,
      { delete: deletePreparation } as unknown as BulkRecordPreparationService,
      { prepare } as IReadOnlyBulkRecordPolicy
    );
    const command = parseBulkDeletePreviewInput({
      tableId: tableId.toString(),
      recordIds: [`rec${'a'.repeat(16)}`, `rec${'b'.repeat(16)}`, `rec${'c'.repeat(16)}`],
    })._unsafeUnwrap();

    const result = await planner.preview(context, command, {
      detail: 'summary',
      includeComplexity: false,
      maxItems: 100,
    });

    expect(result._unsafeUnwrap().blockers.map((issue) => issue.code)).toContain(
      'records.bulkDelete.requested_rows_forbidden'
    );
    expect(result._unsafeUnwrap().warnings.map((issue) => issue.code)).toContain(
      'records.bulkDelete.requested_rows_missing'
    );
    expect(result._unsafeUnwrap().effects[0].measures.affectedRows).toMatchObject({
      basis: 'unknown',
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(deletePreparation).toHaveBeenCalledOnce();
  });

  it('rejects ambiguous and streaming delete shapes instead of guessing a write path', () => {
    const ambiguous = parseBulkDeletePreviewInput({
      tableId: `tbl${'t'.repeat(16)}`,
      recordIds: [`rec${'a'.repeat(16)}`],
      viewId: `viw${'v'.repeat(16)}`,
      ranges: [[0, 0]],
    });
    const stream = parseBulkDeletePreviewInput({
      tableId: `tbl${'t'.repeat(16)}`,
      viewId: `viw${'v'.repeat(16)}`,
      ranges: [[0, 0]],
      targetRecordIds: [`rec${'a'.repeat(16)}`],
    });

    expect(ambiguous._unsafeUnwrapErr().code).toBe('preview.records.bulkDelete.ambiguous_contract');
    expect(stream._unsafeUnwrapErr().code).toBe('preview.records.bulkDelete.streaming_unsupported');
  });
});
