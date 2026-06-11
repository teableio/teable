import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { composeAndSpecs } from '../../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import type { FieldId } from '../../domain/table/fields/FieldId';
import { FieldType } from '../../domain/table/fields/FieldType';
import {
  implementsOnTeableTableDeleted,
  type TableDeletionAfterPersistHook,
  type TableDeletionContext,
  type TableDeletionReaction,
} from '../../domain/table/OnTeableTableDeleted';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import { TableUpdateResult } from '../../domain/table/TableMutator';
import * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { TraceSpan } from '../../ports/TraceSpan';
import { FieldUpdateSideEffectService } from './FieldUpdateSideEffectService';
import { TableUpdateFlow } from './TableUpdateFlow';

export type TableDeletionSideEffectServiceInput = {
  table: Table;
};

export type TableDeletionSideEffectServiceResult = {
  events: ReadonlyArray<IDomainEvent>;
  postPersistEvents: ReadonlyArray<IDomainEvent>;
  updatedTables: ReadonlyArray<Table>;
};

type TableDeletionTypeReaction = {
  reaction: TableDeletionReactionWithAfterPersist;
};

type TableDeletionReactionCollection = {
  isolatedReactions: ReadonlyArray<TableDeletionTypeReaction>;
  batchableSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>;
};

type TableDeletionReactionWithAfterPersist = TableDeletionReaction & {
  readonly afterPersist: TableDeletionAfterPersistHook;
};

@injectable()
// Application service: orchestrates cross-table side effects before a table is deleted.
// Data changes still flow through explicit table-deletion hooks and table specs so adapters can keep work in SQL.
export class TableDeletionSideEffectService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldUpdateSideEffectService)
    private readonly fieldUpdateSideEffectService: FieldUpdateSideEffectService
  ) {}

  @TraceSpan()
  async execute(
    context: ExecutionContextPort.IExecutionContext,
    input: TableDeletionSideEffectServiceInput
  ): Promise<Result<TableDeletionSideEffectServiceResult, DomainError>> {
    const service = this;
    return safeTry<TableDeletionSideEffectServiceResult, DomainError>(async function* () {
      const candidateTables = yield* await service.loadCandidateTables(context, input.table);
      if (candidateTables.length === 0) {
        return ok({ events: [], postPersistEvents: [], updatedTables: [] });
      }

      const updatedTables: Table[] = [];
      const events: IDomainEvent[] = [];
      const postPersistEvents: IDomainEvent[] = [];

      for (const candidateTable of candidateTables) {
        let latestTable = candidateTable;
        const reactingFieldIds = service.prioritizeReactingFieldIds(latestTable, input.table);
        const deletionContext = service.createDeletionContext(latestTable);
        const reactions = yield* service.collectDeletionReactions(
          latestTable,
          reactingFieldIds,
          input.table,
          deletionContext
        );

        for (const reaction of reactions.isolatedReactions) {
          const reactionResult = yield* await service.reactWithAfterPersistReaction(
            context,
            latestTable,
            input.table,
            reaction.reaction
          );
          if (!reactionResult) {
            continue;
          }

          latestTable = reactionResult.table;
          events.push(...reactionResult.events);
          postPersistEvents.push(...reactionResult.postPersistEvents);
        }

        const refreshedBatchableReactions = yield* service.collectDeletionReactions(
          latestTable,
          service.prioritizeReactingFieldIds(latestTable, input.table),
          input.table,
          service.createDeletionContext(latestTable)
        );
        const batchReactionResult = yield* await service.reactWithBatchableSpecs(
          context,
          latestTable,
          refreshedBatchableReactions.batchableSpecs
        );
        if (batchReactionResult) {
          latestTable = batchReactionResult.table;
          events.push(...batchReactionResult.events);
          postPersistEvents.push(...batchReactionResult.postPersistEvents);
        }

        updatedTables.push(latestTable);
      }

      return ok({
        events,
        postPersistEvents,
        updatedTables,
      });
    });
  }

  private async loadCandidateTables(
    context: ExecutionContextPort.IExecutionContext,
    deletedTable: Table
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    const specResult = TableAggregate.specs()
      .byIncomingReferenceToTable(deletedTable.id())
      .not((builder) => builder.byId(deletedTable.id()))
      .build();
    if (specResult.isErr()) {
      return err(specResult.error);
    }

    const tablesResult = await this.tableRepository.find(context, specResult.value);
    if (tablesResult.isErr()) {
      return err(tablesResult.error);
    }

    return ok(tablesResult.value);
  }

  private collectDeletionReactions(
    table: Table,
    reactingFieldIds: ReadonlyArray<FieldId>,
    deletedTable: Table,
    deletionContext: TableDeletionContext
  ): Result<TableDeletionReactionCollection, DomainError> {
    const isolatedReactions: TableDeletionTypeReaction[] = [];
    const batchableSpecs: Array<ISpecification<Table, ITableSpecVisitor>> = [];

    for (const fieldId of reactingFieldIds) {
      const field = table.getField((candidate) => candidate.id().equals(fieldId));
      if (field.isErr() || !implementsOnTeableTableDeleted(field.value)) {
        continue;
      }

      const reactionResult = field.value.onTableDeleted(deletedTable, deletionContext);
      if (reactionResult.isErr()) {
        return err(reactionResult.error);
      }
      if (!reactionResult.value) {
        continue;
      }

      if (this.hasAfterPersist(reactionResult.value)) {
        isolatedReactions.push({
          reaction: reactionResult.value,
        });
        continue;
      }

      batchableSpecs.push(reactionResult.value.spec);
    }

    return ok({
      isolatedReactions,
      batchableSpecs,
    });
  }

  private prioritizeReactingFieldIds(table: Table, deletedTable: Table): ReadonlyArray<FieldId> {
    return [...table.getFields()]
      .sort(
        (left, right) =>
          this.reactionPriority(left, deletedTable) - this.reactionPriority(right, deletedTable)
      )
      .map((field) => field.id());
  }

  private reactionPriority(field: Field, deletedTable: Table): number {
    const foreignTableId = this.getForeignTableId(field);

    if (!foreignTableId || !foreignTableId.equals(deletedTable.id())) {
      return 2;
    }

    return field.type().equals(FieldType.link()) ? 0 : 1;
  }

  private hasAfterPersist(
    reaction: TableDeletionReaction
  ): reaction is TableDeletionReactionWithAfterPersist {
    return reaction.afterPersist != null;
  }

  private getForeignTableId(field: Field): TableId | undefined {
    const candidate = field as Field & {
      foreignTableId?: () => TableId;
    };

    if (typeof candidate.foreignTableId !== 'function') {
      return undefined;
    }

    return candidate.foreignTableId();
  }

  private async reactWithAfterPersistReaction(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    deletedTable: Table,
    reaction: TableDeletionReactionWithAfterPersist
  ): Promise<
    Result<
      | {
          table: Table;
          events: ReadonlyArray<IDomainEvent>;
          postPersistEvents: ReadonlyArray<IDomainEvent>;
        }
      | undefined,
      DomainError
    >
  > {
    const updateResult = await this.tableUpdateFlow.execute(
      context,
      { table },
      (candidate) =>
        reaction.spec
          .mutate(candidate)
          .map((updated) => TableUpdateResult.create(updated, reaction.spec)),
      {
        hooks: {
          afterPersist: (transactionContext, updatedTable) =>
            reaction.afterPersist(transactionContext, updatedTable, deletedTable),
        },
        publishEvents: false,
      }
    );

    return updateResult.map((result) => result);
  }

  private createDeletionContext(table: Table): TableDeletionContext {
    return {
      table,
      hooks: {
        createFieldUpdateAfterPersistHook: (fieldId, updateSpec) => {
          return async (context, updatedTable, currentDeletedTable) => {
            const updatedField = updatedTable.getField((candidate) =>
              candidate.id().equals(fieldId)
            );
            if (updatedField.isErr()) {
              return err(updatedField.error);
            }

            const sideEffectResult = await this.fieldUpdateSideEffectService.execute(context, {
              table: updatedTable,
              updatedField: updatedField.value,
              updateSpecs: [updateSpec],
              foreignTables: [currentDeletedTable],
            });
            if (sideEffectResult.isErr()) {
              return err(sideEffectResult.error);
            }

            return ok({
              events: sideEffectResult.value.events,
              table: sideEffectResult.value.updatedTable,
            });
          };
        },
      },
    };
  }

  private async reactWithBatchableSpecs(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
  ): Promise<
    Result<
      | {
          table: Table;
          events: ReadonlyArray<IDomainEvent>;
          postPersistEvents: ReadonlyArray<IDomainEvent>;
        }
      | undefined,
      DomainError
    >
  > {
    if (specs.length === 0) {
      return ok(undefined);
    }

    const composedSpec = composeAndSpecs(specs);
    if (composedSpec.isErr()) {
      return err(composedSpec.error);
    }

    const updateResult = await this.tableUpdateFlow.execute(
      context,
      { table },
      (candidate) =>
        composedSpec.value
          .mutate(candidate)
          .map((updated) => TableUpdateResult.create(updated, composedSpec.value)),
      { publishEvents: false }
    );

    return updateResult.map((result) => result);
  }
}
