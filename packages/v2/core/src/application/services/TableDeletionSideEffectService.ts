import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
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
import * as TableMapperPort from '../../ports/mappers/TableMapper';
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

export type TableDeletionReactionEffect = {
  readonly tableId: string;
  readonly tableName: string;
  readonly fieldId: string;
  readonly fieldName: string;
  readonly previousType: string;
  readonly nextType: string;
  readonly consequence:
    | 'inbound-link-converted-to-text'
    | 'dependent-field-marked-error'
    | 'dependent-field-updated';
};

export type TableDeletionAfterPersistIntent = {
  readonly kind: 'field-update-side-effects';
  readonly fieldId: string;
};

type PreparedIsolatedReaction = {
  readonly spec: ISpecification<Table, ITableSpecVisitor>;
  readonly afterPersist: TableDeletionAfterPersistIntent;
};

type PreparedCandidateTableReaction = {
  readonly sourceTable: Table;
  readonly isolatedReactions: ReadonlyArray<PreparedIsolatedReaction>;
};

export type TableDeletionSideEffectPreparation = {
  readonly deletedTable: Table;
  readonly candidateEvidence: 'known' | 'unknown';
  readonly candidateTableCount: number;
  readonly downstreamCascadeEvidence: 'unknown' | 'not-applicable';
  readonly reactionEffects: ReadonlyArray<TableDeletionReactionEffect>;
  /** Execution-only domain plan. Public preview adapters must map reactionEffects instead. */
  readonly candidatePlans: ReadonlyArray<PreparedCandidateTableReaction>;
};

type TableDeletionTypeReaction = {
  readonly reaction: TableDeletionReaction;
  readonly fieldId: FieldId;
};

type TableDeletionReactionCollection = {
  readonly isolatedReactions: ReadonlyArray<TableDeletionTypeReaction>;
  readonly batchableSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>;
};

const preparationOnlyAfterPersistHook: TableDeletionAfterPersistHook = () =>
  Promise.resolve(
    err(
      domainError.invariant({
        code: 'table.delete.preparation_hook_invoked',
        message: 'Preparation-only table deletion hook cannot be invoked',
      })
    )
  );

@injectable()
// Application service: prepares cross-table reactions without writes, then executes the prepared plan.
export class TableDeletionSideEffectService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldUpdateSideEffectService)
    private readonly fieldUpdateSideEffectService: FieldUpdateSideEffectService,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapperPort.ITableMapper
  ) {}

  /**
   * Builds ordered domain reactions against detached aggregate states.
   * It never invokes TableUpdateFlow, schema persistence, events, or after-persist hooks.
   */
  @TraceSpan()
  async prepare(
    context: ExecutionContextPort.IExecutionContext,
    input: TableDeletionSideEffectServiceInput
  ): Promise<Result<TableDeletionSideEffectPreparation, DomainError>> {
    const service = this;
    return safeTry<TableDeletionSideEffectPreparation, DomainError>(async function* () {
      const candidateTables = yield* await service.loadCandidateTables(context, input.table);
      const deletedTable = yield* input.table.clone(service.tableMapper);
      const candidatePlans: PreparedCandidateTableReaction[] = [];
      const reactionEffects: TableDeletionReactionEffect[] = [];
      let hasCandidateWithoutReactionEvidence = false;

      for (const candidateTable of candidateTables) {
        const effectCountBeforeCandidate = reactionEffects.length;
        const sourceTable = yield* candidateTable.clone(service.tableMapper);
        let projectedTable = yield* sourceTable.clone(service.tableMapper);
        const isolatedReactions: PreparedIsolatedReaction[] = [];
        const initialReactions = yield* service.collectDeletionReactions(
          projectedTable,
          service.prioritizeReactingFieldIds(projectedTable, deletedTable),
          deletedTable,
          service.createPreparationContext(projectedTable)
        );

        // Link conversion reactions carry after-persist intent and must be projected first.
        // Dependent reactions are deliberately recollected from that projected state.
        for (const item of initialReactions.isolatedReactions) {
          const mutationTarget = yield* projectedTable.clone(service.tableMapper);
          const nextTable = yield* item.reaction.spec.mutate(mutationTarget);
          reactionEffects.push(...service.describeReactionEffects(projectedTable, nextTable));
          projectedTable = nextTable;
          isolatedReactions.push({
            spec: item.reaction.spec,
            afterPersist: {
              kind: 'field-update-side-effects',
              fieldId: item.fieldId.toString(),
            },
          });
        }

        const refreshedReactions = yield* service.collectDeletionReactions(
          projectedTable,
          service.prioritizeReactingFieldIds(projectedTable, deletedTable),
          deletedTable,
          service.createPreparationContext(projectedTable)
        );
        const batchSpec = yield* service.composeBatchSpec(refreshedReactions.batchableSpecs);
        if (batchSpec) {
          const mutationTarget = yield* projectedTable.clone(service.tableMapper);
          const nextTable = yield* batchSpec.mutate(mutationTarget);
          reactionEffects.push(...service.describeReactionEffects(projectedTable, nextTable));
        }

        if (reactionEffects.length === effectCountBeforeCandidate) {
          hasCandidateWithoutReactionEvidence = true;
        }
        candidatePlans.push({ sourceTable, isolatedReactions });
      }

      return ok<TableDeletionSideEffectPreparation, DomainError>({
        deletedTable,
        // A successful but empty metadata query cannot establish that host-owned,
        // stale, or inaccessible references do not exist.
        candidateEvidence:
          candidateTables.length === 0 || hasCandidateWithoutReactionEvidence ? 'unknown' : 'known',
        candidateTableCount: candidateTables.length,
        downstreamCascadeEvidence: candidatePlans.some((plan) => plan.isolatedReactions.length > 0)
          ? 'unknown'
          : 'not-applicable',
        reactionEffects,
        candidatePlans,
      });
    });
  }

  @TraceSpan()
  async executePrepared(
    context: ExecutionContextPort.IExecutionContext,
    preparation: TableDeletionSideEffectPreparation
  ): Promise<Result<TableDeletionSideEffectServiceResult, DomainError>> {
    const service = this;
    return safeTry<TableDeletionSideEffectServiceResult, DomainError>(async function* () {
      const updatedTables: Table[] = [];
      const events: IDomainEvent[] = [];
      const postPersistEvents: IDomainEvent[] = [];

      for (const candidatePlan of preparation.candidatePlans) {
        let latestTable = candidatePlan.sourceTable;
        for (const reaction of candidatePlan.isolatedReactions) {
          const reactionResult = yield* await service.reactWithPreparedAfterPersistReaction(
            context,
            latestTable,
            preparation.deletedTable,
            reaction
          );
          if (!reactionResult) continue;
          latestTable = reactionResult.table;
          events.push(...reactionResult.events);
          postPersistEvents.push(...reactionResult.postPersistEvents);
        }

        // The execution-only field-update hook may have changed dependent metadata.
        // Recollect after the hook, preserving execution's original ordered semantics.
        const refreshedReactions = yield* service.collectDeletionReactions(
          latestTable,
          service.prioritizeReactingFieldIds(latestTable, preparation.deletedTable),
          preparation.deletedTable,
          service.createPreparationContext(latestTable)
        );
        const batchSpec = yield* service.composeBatchSpec(refreshedReactions.batchableSpecs);
        const batchReactionResult = yield* await service.reactWithBatchableSpec(
          context,
          latestTable,
          batchSpec
        );
        if (batchReactionResult) {
          latestTable = batchReactionResult.table;
          events.push(...batchReactionResult.events);
          postPersistEvents.push(...batchReactionResult.postPersistEvents);
        }
        updatedTables.push(latestTable);
      }

      return ok({ events, postPersistEvents, updatedTables });
    });
  }

  /** Executes the same preparation for callers that orchestrate side effects directly. */
  @TraceSpan()
  async execute(
    context: ExecutionContextPort.IExecutionContext,
    input: TableDeletionSideEffectServiceInput
  ): Promise<Result<TableDeletionSideEffectServiceResult, DomainError>> {
    const preparation = await this.prepare(context, input);
    if (preparation.isErr()) return err(preparation.error);
    return this.executePrepared(context, preparation.value);
  }

  private async loadCandidateTables(
    context: ExecutionContextPort.IExecutionContext,
    deletedTable: Table
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    const specResult = TableAggregate.specs()
      .byIncomingReferenceToTable(deletedTable.id())
      .not((builder) => builder.byId(deletedTable.id()))
      .build();
    if (specResult.isErr()) return err(specResult.error);
    return this.tableRepository.find(context, specResult.value);
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
      if (field.isErr() || !implementsOnTeableTableDeleted(field.value)) continue;
      const reactionResult = field.value.onTableDeleted(deletedTable, deletionContext);
      if (reactionResult.isErr()) return err(reactionResult.error);
      if (!reactionResult.value) continue;

      if (reactionResult.value.afterPersist) {
        isolatedReactions.push({ reaction: reactionResult.value, fieldId });
      } else {
        batchableSpecs.push(reactionResult.value.spec);
      }
    }
    return ok({ isolatedReactions, batchableSpecs });
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
    if (!foreignTableId || !foreignTableId.equals(deletedTable.id())) return 2;
    return field.type().equals(FieldType.link()) ? 0 : 1;
  }

  private getForeignTableId(field: Field): TableId | undefined {
    const candidate = field as Field & { foreignTableId?: () => TableId };
    return typeof candidate.foreignTableId === 'function' ? candidate.foreignTableId() : undefined;
  }

  private createPreparationContext(table: Table): TableDeletionContext {
    return {
      table,
      hooks: {
        createFieldUpdateAfterPersistHook: () => preparationOnlyAfterPersistHook,
      },
    };
  }

  private composeBatchSpec(
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
  ): Result<ISpecification<Table, ITableSpecVisitor> | undefined, DomainError> {
    if (specs.length === 0) return ok(undefined);
    return composeAndSpecs(specs);
  }

  private describeReactionEffects(
    before: Table,
    after: Table
  ): ReadonlyArray<TableDeletionReactionEffect> {
    const effects: TableDeletionReactionEffect[] = [];
    for (const previousField of before.getFields()) {
      const nextFieldResult = after.getField((field) => field.id().equals(previousField.id()));
      if (nextFieldResult.isErr()) continue;
      const nextField = nextFieldResult.value;
      const typeChanged = !previousField.type().equals(nextField.type());
      const becameErrored = !previousField.hasError().isError() && nextField.hasError().isError();
      if (!typeChanged && !becameErrored) continue;

      effects.push({
        tableId: after.id().toString(),
        tableName: after.name().toString(),
        fieldId: nextField.id().toString(),
        fieldName: nextField.name().toString(),
        previousType: previousField.type().toString(),
        nextType: nextField.type().toString(),
        consequence:
          typeChanged &&
          previousField.type().equals(FieldType.link()) &&
          nextField.type().equals(FieldType.singleLineText())
            ? 'inbound-link-converted-to-text'
            : becameErrored
              ? 'dependent-field-marked-error'
              : 'dependent-field-updated',
      });
    }
    return effects;
  }

  private async reactWithPreparedAfterPersistReaction(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    deletedTable: Table,
    reaction: PreparedIsolatedReaction
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
    const service = this;
    return this.tableUpdateFlow.execute(
      context,
      { table },
      (candidate) =>
        reaction.spec
          .mutate(candidate)
          .map((updated) => TableUpdateResult.create(updated, reaction.spec)),
      {
        hooks: {
          afterPersist: async (transactionContext, updatedTable) => {
            const updatedField = updatedTable.getField(
              (candidate) => candidate.id().toString() === reaction.afterPersist.fieldId
            );
            if (updatedField.isErr()) return err(updatedField.error);
            const sideEffectResult = await service.fieldUpdateSideEffectService.execute(
              transactionContext,
              {
                table: updatedTable,
                updatedField: updatedField.value,
                updateSpecs: [reaction.spec],
                foreignTables: [deletedTable],
              }
            );
            if (sideEffectResult.isErr()) return err(sideEffectResult.error);
            return ok({
              events: sideEffectResult.value.events,
              table: sideEffectResult.value.updatedTable,
            });
          },
        },
        publishEvents: false,
        finalizeWithinTransaction: true,
      }
    );
  }

  private async reactWithBatchableSpec(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    spec: ISpecification<Table, ITableSpecVisitor> | undefined
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
    if (!spec) return ok(undefined);
    return this.tableUpdateFlow.execute(
      context,
      { table },
      (candidate) =>
        spec.mutate(candidate).map((updated) => TableUpdateResult.create(updated, spec)),
      { publishEvents: false, finalizeWithinTransaction: true }
    );
  }
}
