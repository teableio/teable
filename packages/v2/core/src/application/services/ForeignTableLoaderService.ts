import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../domain/base/BaseId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { ClearFieldValueSpec } from '../../domain/table/records/specs/values/ClearFieldValueSpec';
import type {
  ICellValueSpec,
  ICellValueSpecVisitor,
} from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { SetAttachmentValueSpec } from '../../domain/table/records/specs/values/SetAttachmentValueSpec';
import type { SetCheckboxValueSpec } from '../../domain/table/records/specs/values/SetCheckboxValueSpec';
import type { SetDateValueSpec } from '../../domain/table/records/specs/values/SetDateValueSpec';
import type { SetLinkValueByTitleSpec } from '../../domain/table/records/specs/values/SetLinkValueByTitleSpec';
import type { SetLinkValueSpec } from '../../domain/table/records/specs/values/SetLinkValueSpec';
import type { SetLongTextValueSpec } from '../../domain/table/records/specs/values/SetLongTextValueSpec';
import type { SetMultipleSelectValueSpec } from '../../domain/table/records/specs/values/SetMultipleSelectValueSpec';
import type { SetNumberValueSpec } from '../../domain/table/records/specs/values/SetNumberValueSpec';
import type { SetRatingValueSpec } from '../../domain/table/records/specs/values/SetRatingValueSpec';
import type { SetRowOrderValueSpec } from '../../domain/table/records/specs/values/SetRowOrderValueSpec';
import type { SetSingleLineTextValueSpec } from '../../domain/table/records/specs/values/SetSingleLineTextValueSpec';
import type { SetSingleSelectValueSpec } from '../../domain/table/records/specs/values/SetSingleSelectValueSpec';
import type { SetUserValueByIdentifierSpec } from '../../domain/table/records/specs/values/SetUserValueByIdentifierSpec';
import type { SetUserValueSpec } from '../../domain/table/records/specs/values/SetUserValueSpec';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';

export type ForeignTableLoaderInput = {
  baseId?: BaseId;
  references: ReadonlyArray<LinkForeignTableReference>;
};

export interface IForeignTableLoaderService {
  load(
    context: IExecutionContext,
    input: ForeignTableLoaderInput
  ): Promise<Result<ReadonlyArray<Table>, DomainError>>;
  loadForLinkTitleFill(
    context: IExecutionContext,
    specs: ReadonlyArray<ICellValueSpec | null>
  ): Promise<Result<ReadonlyMap<string, Table>, DomainError>>;
}

class MissingLinkTitleForeignTableCollector implements ICellValueSpecVisitor {
  private readonly references: LinkForeignTableReference[] = [];

  collect(
    specs: ReadonlyArray<ICellValueSpec | null>
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    for (const spec of specs) {
      if (!spec) continue;
      const acceptResult = spec.accept(this);
      if (acceptResult.isErr()) {
        return err(acceptResult.error);
      }
    }

    const unique: LinkForeignTableReference[] = [];
    const seen = new Set<string>();
    for (const reference of this.references) {
      const key = reference.foreignTableId.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(reference);
    }
    return ok(unique);
  }

  visitSetSingleLineTextValue(_spec: SetSingleLineTextValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetLongTextValue(_spec: SetLongTextValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetNumberValue(_spec: SetNumberValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetRatingValue(_spec: SetRatingValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetSingleSelectValue(_spec: SetSingleSelectValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetMultipleSelectValue(_spec: SetMultipleSelectValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetCheckboxValue(_spec: SetCheckboxValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetDateValue(_spec: SetDateValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetAttachmentValue(_spec: SetAttachmentValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetUserValue(_spec: SetUserValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetUserValueByIdentifier(_spec: SetUserValueByIdentifierSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetLinkValue(spec: SetLinkValueSpec): Result<void, DomainError> {
    if (spec.needsTitleResolution() && spec.foreignTableId) {
      this.references.push({ foreignTableId: spec.foreignTableId });
    }
    return ok(undefined);
  }

  visitSetRowOrderValue(_spec: SetRowOrderValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitClearFieldValue(_spec: ClearFieldValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetLinkValueByTitle(_spec: SetLinkValueByTitleSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(_spec: any): Result<void, DomainError> {
    return ok(undefined);
  }

  and(): Result<void, DomainError> {
    return ok(undefined);
  }

  or(): Result<void, DomainError> {
    return ok(undefined);
  }

  not(): Result<void, DomainError> {
    return ok(undefined);
  }
}

@injectable()
// Application service: loads foreign tables once per command and validates missing references.
export class ForeignTableLoaderService implements IForeignTableLoaderService {
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

      const referencesByBaseId = new Map<
        string,
        { baseId?: BaseId; references: LinkForeignTableReference[] }
      >();
      for (const reference of input.references) {
        const baseId = reference.baseId ?? input.baseId;
        const key = baseId?.toString() ?? '__any__';
        const group = referencesByBaseId.get(key) ?? { baseId, references: [] };
        group.references.push(reference);
        referencesByBaseId.set(key, group);
      }

      const foreignTablesById = new Map<string, Table>();
      const missingForeignTableIds: string[] = [];
      for (const { baseId, references } of referencesByBaseId.values()) {
        const spec = yield* TableAggregate.specs(baseId)
          .byIds(references.map((reference) => reference.foreignTableId))
          .build();

        const foreignTables = yield* await tableRepository.find(context, spec);
        const foreignTableIds = new Set(foreignTables.map((table) => table.id().toString()));
        for (const table of foreignTables) {
          foreignTablesById.set(table.id().toString(), table);
        }
        missingForeignTableIds.push(
          ...references
            .filter((reference) => !foreignTableIds.has(reference.foreignTableId.toString()))
            .map((reference) => reference.foreignTableId.toString())
        );
      }

      if (missingForeignTableIds.length > 0)
        return err(
          domainError.notFound({
            message: `Foreign tables not found: ${missingForeignTableIds.join(', ')}`,
            details: {
              missingForeignTableIds,
            },
          })
        );

      return ok(Array.from(foreignTablesById.values()));
    });
    return result;
  }

  async loadForLinkTitleFill(
    context: IExecutionContext,
    specs: ReadonlyArray<ICellValueSpec | null>
  ): Promise<Result<ReadonlyMap<string, Table>, DomainError>> {
    const collector = new MissingLinkTitleForeignTableCollector();
    const referencesResult = collector.collect(specs);
    if (referencesResult.isErr()) {
      return err(referencesResult.error);
    }

    if (referencesResult.value.length === 0) {
      return ok(new Map());
    }

    const foreignTablesResult = await this.load(context, {
      references: referencesResult.value,
    });
    if (foreignTablesResult.isErr()) {
      return err(foreignTablesResult.error);
    }

    return ok(
      new Map(foreignTablesResult.value.map((table) => [table.id().toString(), table] as const))
    );
  }
}

export class NullForeignTableLoaderService implements IForeignTableLoaderService {
  async load(): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok([]);
  }

  async loadForLinkTitleFill(): Promise<Result<ReadonlyMap<string, Table>, DomainError>> {
    return ok(new Map());
  }
}
