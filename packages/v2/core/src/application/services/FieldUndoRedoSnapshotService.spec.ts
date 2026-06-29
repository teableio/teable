import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { BaseId } from '../../domain/base/BaseId';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { FormulaExpression } from '../../domain/table/fields/types/FormulaExpression';
import { FormulaField } from '../../domain/table/fields/types/FormulaField';
import { LinkFieldConfig } from '../../domain/table/fields/types/LinkFieldConfig';
import { LinkRelationship } from '../../domain/table/fields/types/LinkRelationship';
import { LookupOptions } from '../../domain/table/fields/types/LookupOptions';
import { NumberField } from '../../domain/table/fields/types/NumberField';
import { SingleLineTextField } from '../../domain/table/fields/types/SingleLineTextField';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import { CellValueMultiplicity } from '../../domain/table/fields/types/CellValueMultiplicity';
import { CellValueType } from '../../domain/table/fields/types/CellValueType';
import { GridView } from '../../domain/table/views/types/GridView';
import { ViewColumnMeta } from '../../domain/table/views/ViewColumnMeta';
import { ViewId } from '../../domain/table/views/ViewId';
import { ViewName } from '../../domain/table/views/ViewName';
import { ViewQueryDefaults } from '../../domain/table/views/ViewQueryDefaults';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import type {
  ITableRecordQueryOptions,
  ITableRecordQueryRepository,
} from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';

import { FieldUndoRedoSnapshotService } from './FieldUndoRedoSnapshotService';

const buildContext = (): IExecutionContext => ({
  actorId: ActorId.create('actor')._unsafeUnwrap(),
  windowId: 'window-1',
});

const createIds = () => ({
  baseId: BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap(),
  tableId: TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap(),
  titleFieldId: FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap(),
  amountFieldId: FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap(),
  formulaFieldId: FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap(),
  viewId: ViewId.create(`viw${'f'.repeat(16)}`)._unsafeUnwrap(),
});

const buildTable = (
  mode: 'number' | 'formula'
): { table: Table; targetFieldId: FieldId; titleFieldId: FieldId } => {
  const { baseId, tableId, titleFieldId, amountFieldId, formulaFieldId, viewId } = createIds();
  const titleField = SingleLineTextField.create({
    id: titleFieldId,
    name: FieldName.create('Title')._unsafeUnwrap(),
  })._unsafeUnwrap();

  const targetField =
    mode === 'number'
      ? NumberField.create({
          id: amountFieldId,
          name: FieldName.create('Amount')._unsafeUnwrap(),
        })._unsafeUnwrap()
      : (() => {
          const field = FormulaField.create({
            id: formulaFieldId,
            name: FieldName.create('Title Formula')._unsafeUnwrap(),
            expression: FormulaExpression.create('{Title}')._unsafeUnwrap(),
          })._unsafeUnwrap();
          field
            .setResultType(CellValueType.string(), CellValueMultiplicity.single())
            ._unsafeUnwrap();
          return field;
        })();

  const view = GridView.create({
    id: viewId,
    name: ViewName.create('Grid')._unsafeUnwrap(),
  })._unsafeUnwrap();
  view
    .setColumnMeta(
      ViewColumnMeta.create({
        [titleField.id().toString()]: { order: 1, width: 180 },
        [targetField.id().toString()]: { order: 0, width: 320 },
      })._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  view
    .setQueryDefaults(ViewQueryDefaults.create({ manualSort: true })._unsafeUnwrap())
    ._unsafeUnwrap();

  return {
    table: Table.rehydrate({
      id: tableId,
      baseId,
      name: TableName.create('Undo Snapshot')._unsafeUnwrap(),
      fields: [titleField, targetField],
      views: [view],
      primaryFieldId: titleField.id(),
    })._unsafeUnwrap(),
    targetFieldId: targetField.id(),
    titleFieldId,
  };
};

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  calls = 0;
  options: ITableRecordQueryOptions[] = [];
  rows: TableRecordReadModel[] = [];
  error: DomainError | undefined;

  async find(
    _context?: IExecutionContext,
    _table?: Table,
    _spec?: unknown,
    options?: ITableRecordQueryOptions
  ): Promise<Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>> {
    this.calls += 1;
    if (options) {
      this.options.push(options);
    }
    if (this.error) {
      return err(this.error);
    }
    return ok({ records: this.rows, total: this.rows.length });
  }

  async findOne(): Promise<Result<TableRecordReadModel, DomainError>> {
    throw new Error('Not used in test');
  }

  async *findStream(): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    throw new Error('Not used in test');
  }
}

describe('FieldUndoRedoSnapshotService', () => {
  it('captures field snapshots with ordered view metadata and record values', async () => {
    const { table, targetFieldId } = buildTable('number');
    const repository = new FakeTableRecordQueryRepository();
    repository.rows = [
      {
        id: `rec${'1'.repeat(16)}`,
        fields: { [targetFieldId.toString()]: 42 },
        version: 1,
      },
      {
        id: `rec${'2'.repeat(16)}`,
        fields: {},
        version: 2,
      },
    ];
    const service = new FieldUndoRedoSnapshotService(new DefaultTableMapper(), repository);

    const result = await service.capture(buildContext(), table, targetFieldId);
    const snapshot = result._unsafeUnwrap();

    expect(snapshot.field.id).toBe(targetFieldId.toString());
    expect(snapshot.field.type).toBe('number');
    expect(snapshot.views).toHaveLength(1);
    expect(snapshot.views[0]?.orderedFieldIds).toEqual([
      targetFieldId.toString(),
      table.primaryFieldId().toString(),
    ]);
    expect(snapshot.views[0]?.columnMeta).toMatchObject({ order: 0, width: 320 });
    expect(snapshot.views[0]?.query).toEqual({ manualSort: true });
    expect(snapshot.records).toEqual([
      { recordId: `rec${'1'.repeat(16)}`, value: 42 },
      { recordId: `rec${'2'.repeat(16)}`, value: null },
    ]);
    expect(repository.calls).toBe(1);
  });

  it('captures multiple stored field snapshots with one projected record query', async () => {
    const { table, targetFieldId, titleFieldId } = buildTable('number');
    const repository = new FakeTableRecordQueryRepository();
    repository.rows = [
      {
        id: `rec${'1'.repeat(16)}`,
        fields: {
          [titleFieldId.toString()]: 'A',
          [targetFieldId.toString()]: 42,
        },
        version: 1,
      },
      {
        id: `rec${'2'.repeat(16)}`,
        fields: {
          [titleFieldId.toString()]: 'B',
        },
        version: 2,
      },
    ];
    const service = new FieldUndoRedoSnapshotService(new DefaultTableMapper(), repository);

    const result = await service.captureMany(buildContext(), table, [titleFieldId, targetFieldId]);
    const snapshots = result._unsafeUnwrap();

    expect(repository.calls).toBe(1);
    expect(repository.options[0]?.projectionFieldIds?.map((fieldId) => fieldId.toString())).toEqual(
      [titleFieldId.toString(), targetFieldId.toString()]
    );
    expect(snapshots.map((snapshot) => snapshot.field.id)).toEqual([
      titleFieldId.toString(),
      targetFieldId.toString(),
    ]);
    expect(snapshots[0]?.records).toEqual([
      { recordId: `rec${'1'.repeat(16)}`, value: 'A' },
      { recordId: `rec${'2'.repeat(16)}`, value: 'B' },
    ]);
    expect(snapshots[1]?.records).toEqual([
      { recordId: `rec${'1'.repeat(16)}`, value: 42 },
      { recordId: `rec${'2'.repeat(16)}`, value: null },
    ]);
  });

  it('skips record capture for computed fields and when includeRecords is false', async () => {
    const formulaScenario = buildTable('formula');
    const repository = new FakeTableRecordQueryRepository();
    const service = new FieldUndoRedoSnapshotService(new DefaultTableMapper(), repository);

    const formulaSnapshot = await service.capture(
      buildContext(),
      formulaScenario.table,
      formulaScenario.targetFieldId
    );
    expect(formulaSnapshot._unsafeUnwrap().records).toBeUndefined();
    expect(repository.calls).toBe(0);

    const normalScenario = buildTable('number');
    const normalSnapshot = await service.capture(
      buildContext(),
      normalScenario.table,
      normalScenario.targetFieldId,
      { includeRecords: false }
    );
    expect(normalSnapshot._unsafeUnwrap().records).toBeUndefined();
    expect(repository.calls).toBe(0);
  });

  it('captures a lookup field whose enriched options carry link fk metadata', async () => {
    const baseId = BaseId.create(`bse${'g'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'h'.repeat(16)}`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'i'.repeat(16)}`)._unsafeUnwrap();
    const primaryFieldId = FieldId.create(`fld${'j'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
    const foreignTargetFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignTargetFieldId.toString(),
    })._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('Lookup Undo')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(primaryFieldId)
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Link')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    builder
      .field()
      .lookup()
      .withId(lookupFieldId)
      .withName(FieldName.create('Lookup Amount')._unsafeUnwrap())
      .withInnerField(
        NumberField.create({
          id: FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap(),
          name: FieldName.create('Amount')._unsafeUnwrap(),
        })._unsafeUnwrap()
      )
      .withLookupOptions(
        LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignTargetFieldId.toString(),
        })._unsafeUnwrap()
      )
      .withIsMultipleCellValue(false)
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const service = new FieldUndoRedoSnapshotService(
      new DefaultTableMapper(),
      new FakeTableRecordQueryRepository()
    );

    // Regression: the enriched lookupOptions (fk metadata) must be reduced to the strict
    // create-field input schema; otherwise capture fails with "Invalid field undo/redo snapshot input".
    const snapshot = (await service.capture(buildContext(), table, lookupFieldId))._unsafeUnwrap();

    expect(snapshot.field.type).toBe('lookup');
    const options = (snapshot.field as { options?: Record<string, unknown> }).options ?? {};
    expect(options).toEqual({
      linkFieldId: linkFieldId.toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignTargetFieldId.toString(),
    });
    expect(options).not.toHaveProperty('fkHostTableName');
    expect(options).not.toHaveProperty('relationship');
  });

  it('returns empty record snapshots when the stored column is missing', async () => {
    const { table, targetFieldId } = buildTable('number');
    const repository = new FakeTableRecordQueryRepository();
    repository.error = domainError.infrastructure({
      code: 'db.undefined_column',
      message: 'column does not exist',
    });
    const service = new FieldUndoRedoSnapshotService(new DefaultTableMapper(), repository);

    const result = await service.capture(buildContext(), table, targetFieldId);

    expect(result._unsafeUnwrap().records).toEqual([]);
    expect(repository.calls).toBe(1);
  });
});
