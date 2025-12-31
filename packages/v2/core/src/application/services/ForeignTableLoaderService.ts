import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../domain/base/BaseId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';

export type ForeignTableLoaderInput = {
  baseId: BaseId;
  references: ReadonlyArray<LinkForeignTableReference>;
};

@injectable()
// Application service: loads foreign tables once per command and validates missing references.
export class ForeignTableLoaderService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository
  ) {}

  async load(
    context: IExecutionContext,
    input: ForeignTableLoaderInput
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    const tableRepository = this.tableRepository;
    const result = await safeTry<ReadonlyArray<Table>, DomainError>(async function* () {
      if (input.references.length === 0) return ok([]);

      const spec = yield* TableAggregate.specs(input.baseId)
        .withoutBaseId()
        .byIds(input.references.map((reference) => reference.foreignTableId))
        .build();

      const foreignTables = yield* await tableRepository.find(context, spec);
      const foreignTableIds = new Set(foreignTables.map((table) => table.id().toString()));
      const missing = input.references.filter(
        (reference) => !foreignTableIds.has(reference.foreignTableId.toString())
      );
      if (missing.length > 0)
        return err(domainError.notFound({ message: 'Foreign tables not found' }));

      return ok(foreignTables);
    });
    return result;
  }
}
