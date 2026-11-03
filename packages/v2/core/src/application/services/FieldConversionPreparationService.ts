import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { buildUpdateFieldSpecs } from '../../commands/TableFieldUpdateSpecs';
import { UpdateFieldCommand } from '../../commands/UpdateFieldCommand';
import { domainError, isNotFoundError, type DomainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import {
  LinkForeignTableReferenceVisitor,
  type LinkForeignTableReference,
} from '../../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { TableRecordAggregation } from '../../domain/table/records/TableRecordAggregation';
import { fieldUpdateSpecRequiresDataRewrite } from '../../domain/table/specs/FieldUpdateSpecDataImpact';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { TableUpdateFieldTypeSpec } from '../../domain/table/specs/TableUpdateFieldTypeSpec';
import { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableMapper } from '../../ports/mappers/TableMapper';
import type { ITableRecordAggregationQueryRepository } from '../../ports/TableRecordQueryRepository';
import type { ITableRepository } from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import {
  collectFieldUpdateSideEffects,
  type FieldOperationSideEffect,
} from './FieldOperationSideEffectPluginSupport';
import type { IForeignTableLoaderService } from './ForeignTableLoaderService';

/** The metadata read set shared by conversion preparation and observational host admission. */
export const collectFieldConversionForeignTableReferences = (
  command: UpdateFieldCommand,
  previousField: Field
): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> =>
  safeTry<ReadonlyArray<LinkForeignTableReference>, DomainError>(function* () {
    const commandReferences = yield* command.foreignTableReferences();
    const existingReferences = yield* new LinkForeignTableReferenceVisitor().collect([
      previousField,
    ]);
    const references = [...commandReferences];
    for (const reference of existingReferences) {
      if (!references.some((item) => item.foreignTableId.equals(reference.foreignTableId))) {
        references.push(reference);
      }
    }
    return ok(references);
  });

/** Internal application facts; executable specifications never belong in a public preview DTO. */
export type FieldConversionPreparation = {
  readonly command: UpdateFieldCommand;
  readonly table: Table;
  readonly previousField: Field;
  readonly foreignTables: ReadonlyArray<Table>;
  readonly updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>;
  readonly plannedSideEffects: ReadonlyArray<FieldOperationSideEffect>;
  readonly isNoop: boolean;
  readonly isTypeConversion: boolean;
  readonly requiresDataRewrite: boolean;
  /** Null means no valid filled-cell aggregation evidence was returned. */
  readonly affectedCellCount: number | null;
  readonly linkSideEffectCount: number;
};

/**
 * Shared read-only preparation for update execution and conversion preview.
 * Only metadata reads, optional aggregation, and detached domain mutation are available here.
 * Field-operation plugins and all persistence/undo/event lifecycles belong to the write handler.
 */
@injectable()
export class FieldConversionPreparationService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: Pick<ITableRepository, 'findOne'>,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: ITableMapper,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: Pick<IForeignTableLoaderService, 'load'>
  ) {}

  async prepare(
    context: IExecutionContext,
    input: unknown,
    options?: {
      readonly allowNoop?: boolean;
      readonly aggregationRepository?: Pick<ITableRecordAggregationQueryRepository, 'aggregate'>;
    }
  ): Promise<Result<FieldConversionPreparation, DomainError>> {
    const service = this;
    return safeTry<FieldConversionPreparation, DomainError>(async function* () {
      const command = yield* input instanceof UpdateFieldCommand
        ? ok(input)
        : UpdateFieldCommand.create(input, { allowNoop: options?.allowNoop ?? true });
      const whereSpec = yield* Table.specs().byId(command.tableId).build();
      const tableResult = await service.tableRepository.findOne(context, whereSpec);
      if (tableResult.isErr()) {
        return err(
          isNotFoundError(tableResult.error)
            ? domainError.notFound({ code: 'table.not_found', message: 'Table not found' })
            : tableResult.error
        );
      }
      const table = tableResult.value;
      const previousField = yield* table.getField((field) => field.id().equals(command.fieldId));
      const references = yield* collectFieldConversionForeignTableReferences(
        command,
        previousField
      );
      const foreignTables = yield* await service.foreignTableLoaderService.load(context, {
        references,
      });
      const updateSpecs = yield* buildUpdateFieldSpecs(previousField, command.fieldUpdate, {
        hostTable: table,
        foreignTables,
        executionContext: context,
      });
      const isNoop = updateSpecs.length === 0;
      if (isNoop && !command.allowNoop) {
        return err(domainError.validation({ message: 'No changes to apply' }));
      }
      const requiresDataRewrite = updateSpecs.some(fieldUpdateSpecRequiresDataRewrite);
      const isTypeConversion = updateSpecs.some(
        (spec) => spec instanceof TableUpdateFieldTypeSpec && spec.isTypeConversion()
      );
      let plannedSideEffects: ReadonlyArray<FieldOperationSideEffect> = [];
      if (!isNoop) {
        const detachedTable = yield* table.clone(service.tableMapper);
        const detachedPreviousField = yield* detachedTable.getField((field) =>
          field.id().equals(command.fieldId)
        );
        const detachedUpdate = yield* detachedTable.update((mutator) =>
          mutator.updateField(command.fieldId, updateSpecs, { foreignTables })
        );
        const detachedUpdatedField = yield* detachedUpdate.table.getField((field) =>
          field.id().equals(command.fieldId)
        );
        plannedSideEffects = yield* collectFieldUpdateSideEffects(
          detachedTable,
          detachedUpdatedField,
          detachedPreviousField,
          foreignTables
        );
      }
      let affectedCellCount: number | null = requiresDataRewrite ? null : 0;
      if (requiresDataRewrite && options?.aggregationRepository) {
        const aggregation = TableRecordAggregation.create(
          [{ fieldId: command.fieldId, statisticFunc: 'filled' }],
          []
        );
        const values = yield* await options.aggregationRepository.aggregate(
          context,
          table,
          aggregation
        );
        const filled = values.find(
          (value) => value.statisticFunc === 'filled' && value.fieldId.equals(command.fieldId)
        );
        const count = filled?.value;
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
          affectedCellCount = count;
        } else if (typeof count === 'string' && /^\d+$/.test(count)) {
          const parsedCount = Number(count);
          if (Number.isSafeInteger(parsedCount)) affectedCellCount = parsedCount;
        }
      }
      return ok({
        command,
        table,
        previousField,
        foreignTables,
        updateSpecs,
        plannedSideEffects,
        isNoop,
        isTypeConversion,
        requiresDataRewrite,
        affectedCellCount,
        linkSideEffectCount: plannedSideEffects.length,
      });
    });
  }
}
