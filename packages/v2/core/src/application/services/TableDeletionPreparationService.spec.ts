import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { DeleteTableCommand } from '../../commands/DeleteTableCommand';
import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../../domain/table/fields/types/LinkFieldConfig';
import { LinkRelationship } from '../../domain/table/fields/types/LinkRelationship';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { TableSortKey } from '../../domain/table/TableSortKey';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { IFindOptions } from '../../ports/RepositoryQuery';
import type {
  ITableRepository,
  TableDeleteOptions,
  TableFindOptions,
  TableProvisionState,
} from '../../ports/TableRepository';
import { TableDeletionPreparationService } from './TableDeletionPreparationService';
import type { TableDeletionSideEffectPreparation } from './TableDeletionSideEffectService';

const context: IExecutionContext = { actorId: ActorId.create('system')._unsafeUnwrap() };

const createTable = () => {
  const builder = TableAggregate.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Delete me')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class FakeTableRepository implements ITableRepository {
  readonly findStates: Array<TableFindOptions['state'] | undefined> = [];
  deleteCalls = 0;
  provisionCalls = 0;

  constructor(
    readonly table: Table,
    readonly active: boolean
  ) {}

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(tables);
  }

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    options?: Pick<TableFindOptions, 'state'>
  ): Promise<Result<Table, DomainError>> {
    this.findStates.push(options?.state);
    if (!spec.isSatisfiedBy(this.table)) return err(domainError.notFound({ message: 'missing' }));
    if (options?.state === 'activeAnyProvision' && !this.active) {
      return err(domainError.notFound({ message: 'missing' }));
    }
    return ok(this.table);
  }

  async find(
    _: IExecutionContext,
    __: ISpecification<Table, ITableSpecVisitor>,
    ___?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok([]);
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    throw new Error('updateOne must not run during preparation');
  }

  async restore(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    throw new Error('restore must not run during preparation');
  }

  async delete(
    _: IExecutionContext,
    __: Table,
    ___?: TableDeleteOptions
  ): Promise<Result<void, DomainError>> {
    this.deleteCalls += 1;
    return ok(undefined);
  }

  async setProvisionState(
    _: IExecutionContext,
    __: Table,
    ___: TableProvisionState
  ): Promise<Result<void, DomainError>> {
    this.provisionCalls += 1;
    return ok(undefined);
  }

  async setProvisionStateMany(
    _: IExecutionContext,
    __: ReadonlyArray<Table>,
    ___: TableProvisionState
  ): Promise<Result<void, DomainError>> {
    this.provisionCalls += 1;
    return ok(undefined);
  }
}

class FakeSideEffectPreparationService {
  prepareCalls = 0;
  executeCalls = 0;

  async prepare(
    _: IExecutionContext,
    input: { table: Table }
  ): Promise<Result<TableDeletionSideEffectPreparation, DomainError>> {
    this.prepareCalls += 1;
    return ok({
      deletedTable: input.table,
      candidateEvidence: 'unknown',
      candidateTableCount: 0,
      downstreamCascadeEvidence: 'not-applicable',
      reactionEffects: [],
      candidatePlans: [],
    });
  }

  async executePrepared(): Promise<Result<never, DomainError>> {
    this.executeCalls += 1;
    throw new Error('executePrepared must not run during preparation');
  }
}

describe('TableDeletionPreparationService', () => {
  it('prepares a soft delete entirely before persistence', async () => {
    const table = createTable();
    const repository = new FakeTableRepository(table, true);
    const sideEffects = new FakeSideEffectPreparationService();
    const service = new TableDeletionPreparationService(repository, sideEffects as never);
    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'soft',
    })._unsafeUnwrap();

    const preparation = (await service.prepare(context, command))._unsafeUnwrap();

    expect(preparation).toMatchObject({ mode: 'soft', sourceState: 'active', blockers: [] });
    expect(repository.findStates).toEqual(['activeAnyProvision']);
    expect(sideEffects.prepareCalls).toBe(1);
    expect(sideEffects.executeCalls).toBe(0);
    expect(repository.deleteCalls).toBe(0);
    expect(repository.provisionCalls).toBe(0);
  });

  it('distinguishes active permanent delete from an already-trashed permanent delete', async () => {
    const table = createTable();
    const activeRepository = new FakeTableRepository(table, true);
    const activeService = new TableDeletionPreparationService(
      activeRepository,
      new FakeSideEffectPreparationService() as never
    );
    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'permanent',
    })._unsafeUnwrap();

    expect((await activeService.prepare(context, command))._unsafeUnwrap().sourceState).toBe(
      'active'
    );
    expect(activeRepository.findStates).toEqual(['activeAnyProvision']);

    const trashedRepository = new FakeTableRepository(table, false);
    const trashedService = new TableDeletionPreparationService(
      trashedRepository,
      new FakeSideEffectPreparationService() as never
    );
    expect((await trashedService.prepare(context, command))._unsafeUnwrap().sourceState).toBe(
      'trashed'
    );
    expect(trashedRepository.findStates).toEqual(['activeAnyProvision', 'all']);
  });

  it('returns table.not_found without preparing side effects when metadata is missing', async () => {
    const requestedTable = createTable();
    const unrelatedTable = createTable();
    const repository = new FakeTableRepository(unrelatedTable, false);
    const sideEffects = new FakeSideEffectPreparationService();
    const service = new TableDeletionPreparationService(repository, sideEffects as never);
    const command = DeleteTableCommand.create({
      baseId: requestedTable.baseId().toString(),
      tableId: requestedTable.id().toString(),
      mode: 'permanent',
    })._unsafeUnwrap();

    const result = await service.prepare(context, command);

    expect(result._unsafeUnwrapErr().code).toBe('table.not_found');
    expect(sideEffects.prepareCalls).toBe(0);
    expect(repository.deleteCalls).toBe(0);
  });
});

describe('TableDeletionPreparationService.prepareSoftDeleteMany', () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableIdOf = (char: string) => TableId.create(`tbl${char.repeat(16)}`)._unsafeUnwrap();
  const primaryOf = (char: string) => FieldId.create(`fld${char.repeat(16)}`)._unsafeUnwrap();

  /** A table, optionally with a link field to `linksTo`. */
  const tableOf = (char: string, linksTo?: string) => {
    const builder = TableAggregate.builder()
      .withId(tableIdOf(char))
      .withBaseId(baseId)
      .withName(TableName.create(`Table ${char}`)._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(primaryOf(char))
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    if (linksTo) {
      builder
        .field()
        .link()
        .withId(FieldId.create(`fld${char.repeat(15)}l`)._unsafeUnwrap())
        .withName(FieldName.create('Link')._unsafeUnwrap())
        .withConfig(
          LinkFieldConfig.create({
            relationship: LinkRelationship.manyOne().toString(),
            foreignTableId: tableIdOf(linksTo).toString(),
            lookupFieldId: primaryOf(linksTo).toString(),
          })._unsafeUnwrap()
        )
        .done();
    }
    builder.view().defaultGrid().done();
    return builder.build()._unsafeUnwrap();
  };

  it('reads the tables and every table linking to them once, then prepares each alone', async () => {
    const target = tableOf('a');
    const linkedTarget = tableOf('b', 'a');
    const outside = tableOf('c', 'a');
    const all = [target, linkedTarget, outside];
    let findCalls = 0;
    const repository = {
      find: async (_: IExecutionContext, spec: ISpecification<Table, ITableSpecVisitor>) => {
        findCalls += 1;
        return ok(all.filter((table) => spec.isSatisfiedBy(table)));
      },
    };
    const candidatesByTable = new Map<string, string[]>();
    const sideEffects = {
      prepare: async (
        _: IExecutionContext,
        input: { table: Table; candidateTables?: ReadonlyArray<Table> }
      ) => {
        candidatesByTable.set(
          input.table.id().toString(),
          (input.candidateTables ?? []).map((table) => table.id().toString())
        );
        return new FakeSideEffectPreparationService().prepare(_, input);
      },
    };
    const service = new TableDeletionPreparationService(repository as never, sideEffects as never);

    const preparations = (
      await service.prepareSoftDeleteMany(context, baseId, [target.id(), linkedTarget.id()])
    )._unsafeUnwrap();

    expect(findCalls).toBe(2);
    expect(preparations.map((p) => [p.table.id().toString(), p.mode, p.sourceState])).toEqual([
      [target.id().toString(), 'soft', 'active'],
      [linkedTarget.id().toString(), 'soft', 'active'],
    ]);
    expect(candidatesByTable.get(target.id().toString())).toEqual([
      linkedTarget.id().toString(),
      outside.id().toString(),
    ]);
    expect(candidatesByTable.get(linkedTarget.id().toString())).toEqual([]);
  });
});
