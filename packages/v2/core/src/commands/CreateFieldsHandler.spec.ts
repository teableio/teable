import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import type { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoStackService } from '../application/services/UndoRedoStackService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { FormulaField } from '../domain/table/fields/types/FormulaField';
import type { LookupField } from '../domain/table/fields/types/LookupField';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import {
  flattenUndoRedoCommands,
  type UndoRedoApplyFieldSnapshotCommandData,
  type UndoRedoDeleteFieldCommandData,
} from '../ports/UndoRedoStore';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { CreateFieldsCommand } from './CreateFieldsCommand';
import { CreateFieldsHandler } from './CreateFieldsHandler';

const createContext = (windowId?: string): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
  ...(windowId ? { windowId } : {}),
});

class InMemoryTableRepository implements ITableRepository {
  tables: Table[] = [];

  async insert(_context: IExecutionContext, table: Table) {
    this.tables.push(table);
    return ok(table);
  }

  async insertMany(_context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.tables.push(...tables);
    return ok([...tables]);
  }

  async findOne(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const match = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!match) {
      return err(domainError.notFound({ message: 'Not found' }));
    }
    return ok(match);
  }

  async find(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const index = this.tables.findIndex((entry) => entry.id().equals(table.id()));
    if (index === -1) {
      return err(domainError.notFound({ message: 'Not found' }));
    }
    this.tables[index] = table;
    return ok(undefined);
  }

  async restore(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  lastMutateSpec: ISpecification<Table, ITableSpecVisitor> | undefined;

  async insert(_context: IExecutionContext, _table: Table) {
    return ok(undefined);
  }

  async insertMany(_context: IExecutionContext, _tables: ReadonlyArray<Table>) {
    return ok(undefined);
  }

  async update(
    _context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ) {
    this.lastMutateSpec = mutateSpec;
    return ok(table);
  }

  async delete(_context: IExecutionContext, _table: Table) {
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  async publish(_context: IExecutionContext, _event: IDomainEvent) {
    return ok(undefined);
  }

  async publishMany(_context: IExecutionContext, _events: ReadonlyArray<IDomainEvent>) {
    return ok(undefined);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    return work({ ...context, transaction });
  }
}

class TrackingUndoRedoService {
  recordEntryCalls = 0;
  latestEntry:
    | {
        undoCommand: unknown;
        redoCommand: unknown;
      }
    | undefined;

  async recordEntry(
    _context: IExecutionContext,
    _tableId: TableId,
    entry: { undoCommand: unknown; redoCommand: unknown }
  ) {
    this.recordEntryCalls += 1;
    this.latestEntry = entry;
    return ok(undefined);
  }

  async appendEntry(
    _context: IExecutionContext,
    _tableId: TableId,
    entry: { undoCommand: unknown; redoCommand: unknown }
  ) {
    this.recordEntryCalls += 1;
    this.latestEntry = entry;
    return ok(undefined);
  }
}

class TrackingFieldUndoRedoSnapshotService {
  capturedFieldIds: string[] = [];

  async capture(_context: IExecutionContext, _table: Table, fieldId: FieldId) {
    this.capturedFieldIds.push(fieldId.toString());
    return ok({
      field: {
        id: fieldId.toString(),
        name: `Snapshot ${fieldId.toString()}`,
        type: 'singleLineText',
      },
      views: [],
    });
  }
}

const buildTable = (params: {
  baseId: string;
  tableId: string;
  tableName: string;
  primaryFieldId: string;
}) =>
  Table.builder()
    .withId(TableId.create(params.tableId)._unsafeUnwrap())
    .withBaseId(BaseId.create(params.baseId)._unsafeUnwrap())
    .withName(TableName.create(params.tableName)._unsafeUnwrap())
    .field()
    .singleLineText()
    .withId(FieldId.create(params.primaryFieldId)._unsafeUnwrap())
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done()
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();

describe('CreateFieldsHandler', () => {
  it('creates multiple formulas that depend on the same same-table field in one batch', async () => {
    const baseId = `bse${'m'.repeat(16)}`;
    const tableId = `tbl${'n'.repeat(16)}`;
    const primaryFieldId = `fld${'o'.repeat(16)}`;
    const numberFieldId = `fld${'p'.repeat(16)}`;
    const formulaAId = `fld${'q'.repeat(16)}`;
    const formulaBId = `fld${'r'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const tableSchemaRepository = new FakeTableSchemaRepository();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      tableSchemaRepository,
      new FakeEventBus(),
      new FakeUnitOfWork()
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const handler = new CreateFieldsHandler(
      tableUpdateFlow,
      fieldCreationSideEffectService,
      new ForeignTableLoaderService(tableRepository),
      {
        appendEntry: async () => ok(undefined),
      } as unknown as UndoRedoStackService,
      {
        capture: async () =>
          ok({
            field: {
              id: numberFieldId,
              name: 'Snapshot',
              type: 'number',
            },
            views: [],
          }),
      } as unknown as FieldUndoRedoSnapshotService
    );

    const hostTable = buildTable({
      baseId,
      tableId,
      tableName: 'Host Table',
      primaryFieldId,
    });
    await tableRepository.insert(createContext(), hostTable);

    const command = CreateFieldsCommand.create({
      baseId,
      tableId,
      fields: [
        {
          id: numberFieldId,
          name: 'Amount',
          type: 'number',
        },
        {
          id: formulaAId,
          name: 'Amount Plus One',
          type: 'formula',
          options: {
            expression: `{${numberFieldId}} + 1`,
          },
        },
        {
          id: formulaBId,
          name: 'Amount Plus Two',
          type: 'formula',
          options: {
            expression: `{${numberFieldId}} + 2`,
          },
        },
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    const createdFields = result._unsafeUnwrap().fields;
    expect(createdFields.map((field) => field.id().toString())).toEqual([
      numberFieldId,
      formulaAId,
      formulaBId,
    ]);

    const updatedTable = tableRepository.tables.find((entry) => entry.id().equals(hostTable.id()))!;
    const numberField = updatedTable
      .getField((field) => field.id().equals(FieldId.create(numberFieldId)._unsafeUnwrap()))
      ._unsafeUnwrap();
    expect(numberField.dependents().map((id) => id.toString())).toEqual([formulaAId, formulaBId]);

    const visitCounts = {
      addField: 0,
      addFields: 0,
      updateViewColumnMeta: 0,
    };
    const visitResult = tableSchemaRepository.lastMutateSpec?.accept({
      visit: () => ok(undefined),
      visitTableAddField: () => {
        visitCounts.addField += 1;
        return ok(undefined);
      },
      visitTableAddFields: () => {
        visitCounts.addFields += 1;
        return ok(undefined);
      },
      visitTableUpdateViewColumnMeta: () => {
        visitCounts.updateViewColumnMeta += 1;
        return ok(undefined);
      },
    } as unknown as ITableSpecVisitor<void>);
    expect(visitResult?.isOk()).toBe(true);
    expect(visitCounts).toEqual({
      addField: 0,
      addFields: 1,
      updateViewColumnMeta: 1,
    });
  });

  it('creates same-table dependent fields and applies link side effects once', async () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const hostTableId = `tbl${'b'.repeat(16)}`;
    const foreignTableId = `tbl${'c'.repeat(16)}`;
    const hostPrimaryId = `fld${'d'.repeat(16)}`;
    const foreignPrimaryId = `fld${'e'.repeat(16)}`;
    const linkFieldId = `fld${'f'.repeat(16)}`;
    const lookupFieldId = `fld${'g'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const handler = new CreateFieldsHandler(
      tableUpdateFlow,
      fieldCreationSideEffectService,
      new ForeignTableLoaderService(tableRepository),
      {
        appendEntry: async () => ok(undefined),
      } as unknown as UndoRedoStackService,
      {
        capture: async () => err(domainError.unexpected({ message: 'unreachable' })),
      } as unknown as FieldUndoRedoSnapshotService
    );

    tableRepository.tables.push(
      buildTable({
        baseId,
        tableId: hostTableId,
        tableName: 'Host',
        primaryFieldId: hostPrimaryId,
      }),
      buildTable({
        baseId,
        tableId: foreignTableId,
        tableName: 'Foreign',
        primaryFieldId: foreignPrimaryId,
      })
    );

    const command = CreateFieldsCommand.create({
      baseId,
      tableId: hostTableId,
      fields: [
        {
          id: linkFieldId,
          type: 'link',
          name: 'Projects',
          options: {
            relationship: 'manyMany',
            foreignTableId,
            lookupFieldId: foreignPrimaryId,
          },
        },
        {
          id: lookupFieldId,
          type: 'lookup',
          name: 'Project Name',
          options: {
            linkFieldId,
            foreignTableId,
            lookupFieldId: foreignPrimaryId,
          },
        },
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.fields.map((field) => field.id().toString())).toEqual([
      linkFieldId,
      lookupFieldId,
    ]);

    const hostTable = tableRepository.tables.find((table) => table.id().toString() === hostTableId);
    const foreignTable = tableRepository.tables.find(
      (table) => table.id().toString() === foreignTableId
    );
    expect(hostTable).toBeDefined();
    expect(foreignTable).toBeDefined();
    if (!hostTable || !foreignTable) {
      return;
    }

    const lookupField = hostTable.getField(
      (field): field is LookupField => field.id().toString() === lookupFieldId
    );
    expect(lookupField.isOk()).toBe(true);
    expect(
      foreignTable.getFields().filter((field) => field.type().toString() === 'link')
    ).toHaveLength(1);
  });

  it('records one batch undo/redo entry and resolves same-batch dependencies before creation', async () => {
    const baseId = `bse${'h'.repeat(16)}`;
    const tableId = `tbl${'i'.repeat(16)}`;
    const primaryFieldId = `fld${'j'.repeat(16)}`;
    const numberFieldId = `fld${'k'.repeat(16)}`;
    const formulaFieldId = `fld${'l'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const undoRedoService = new TrackingUndoRedoService();
    const snapshotService = new TrackingFieldUndoRedoSnapshotService();
    const handler = new CreateFieldsHandler(
      tableUpdateFlow,
      fieldCreationSideEffectService,
      new ForeignTableLoaderService(tableRepository),
      undoRedoService as unknown as UndoRedoStackService,
      snapshotService as unknown as FieldUndoRedoSnapshotService
    );

    tableRepository.tables.push(
      buildTable({
        baseId,
        tableId,
        tableName: 'Host',
        primaryFieldId,
      })
    );

    const command = CreateFieldsCommand.create({
      baseId,
      tableId,
      fields: [
        {
          id: formulaFieldId,
          type: 'formula',
          name: 'Amount Formula',
          options: {
            expression: `{${numberFieldId}}`,
          },
        },
        {
          id: numberFieldId,
          type: 'number',
          name: 'Amount',
        },
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext('win-create-fields'), command);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.fields.map((field) => field.id().toString())).toEqual([
      formulaFieldId,
      numberFieldId,
    ]);
    const createdFormula = result.value.table.getField(
      (field): field is FormulaField => field.id().toString() === formulaFieldId
    );
    expect(createdFormula.isOk()).toBe(true);
    expect(snapshotService.capturedFieldIds).toEqual([numberFieldId, formulaFieldId]);
    expect(undoRedoService.recordEntryCalls).toBe(1);

    const undoLeaves = flattenUndoRedoCommands(
      undoRedoService.latestEntry?.undoCommand as never
    ).filter((leaf): leaf is UndoRedoDeleteFieldCommandData => leaf.type === 'DeleteField');
    expect(undoLeaves.map((leaf) => leaf.type)).toEqual(['DeleteField', 'DeleteField']);
    expect(undoLeaves.map((leaf) => leaf.payload.fieldId)).toEqual([formulaFieldId, numberFieldId]);

    const redoLeaves = flattenUndoRedoCommands(
      undoRedoService.latestEntry?.redoCommand as never
    ).filter(
      (leaf): leaf is UndoRedoApplyFieldSnapshotCommandData => leaf.type === 'ApplyFieldSnapshot'
    );
    expect(redoLeaves.map((leaf) => leaf.type)).toEqual([
      'ApplyFieldSnapshot',
      'ApplyFieldSnapshot',
    ]);
    expect(redoLeaves.map((leaf) => leaf.payload.snapshot.field.id)).toEqual([
      numberFieldId,
      formulaFieldId,
    ]);
  });
});
