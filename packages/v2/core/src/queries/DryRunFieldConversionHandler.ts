import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { collectFieldUpdateAddSideEffects } from '../application/services/FieldOperationSideEffectPluginSupport';
import { UpdateFieldCommand } from '../commands/UpdateFieldCommand';
import { buildUpdateFieldSpecs } from '../commands/TableFieldUpdateSpecs';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import { LinkField } from '../domain/table/fields/types/LinkField';
import { LinkForeignTableReferenceVisitor } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { TableRecordAggregation } from '../domain/table/records/TableRecordAggregation';
import { fieldUpdateSpecRequiresDataRewrite } from '../domain/table/specs/FieldUpdateSpecDataImpact';
import { TableUpdateFieldTypeSpec } from '../domain/table/specs/TableUpdateFieldTypeSpec';
import { Table as TableAggregate } from '../domain/table/Table';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import type { ITableMapper } from '../ports/mappers/TableMapper';
import { ITableRepository } from '../ports/TableRepository';
import type { ITableRecordAggregationQueryRepository } from '../ports/TableRecordQueryRepository';
import { v2CoreTokens } from '../ports/tokens';
import { DryRunFieldConversionQuery } from './DryRunFieldConversionQuery';
import { QueryHandler, type IQueryHandler } from './QueryHandler';

/**
 * Outcome of a field-conversion dry run: what applying the update WOULD do,
 * without touching storage. Deliberately uses dry-run semantics rather than
 * v1 "plan" semantics (no dependency-graph payload): callers learn whether
 * anything changes at all, whether stored cells would be rewritten, how many
 * non-empty cells the rewrite touches on the host field, and how many
 * cross-table link side effects (symmetric field changes) would occur.
 */
export class FieldConversionDryRunResult {
  private constructor(
    readonly isNoop: boolean,
    readonly isTypeConversion: boolean,
    readonly requiresDataRewrite: boolean,
    readonly affectedCellCount: number,
    readonly linkSideEffectCount: number
  ) {}

  static create(params: {
    isNoop: boolean;
    isTypeConversion: boolean;
    requiresDataRewrite: boolean;
    affectedCellCount: number;
    linkSideEffectCount: number;
  }): FieldConversionDryRunResult {
    return new FieldConversionDryRunResult(
      params.isNoop,
      params.isTypeConversion,
      params.requiresDataRewrite,
      params.affectedCellCount,
      params.linkSideEffectCount
    );
  }

  static noop(): FieldConversionDryRunResult {
    return new FieldConversionDryRunResult(true, false, false, 0, 0);
  }
}

@QueryHandler(DryRunFieldConversionQuery)
@injectable()
export class DryRunFieldConversionHandler
  implements IQueryHandler<DryRunFieldConversionQuery, FieldConversionDryRunResult>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: ITableMapper,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: ITableRecordAggregationQueryRepository
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    query: DryRunFieldConversionQuery
  ): Promise<Result<FieldConversionDryRunResult, DomainError>> {
    const handler = this;
    return safeTry<FieldConversionDryRunResult, DomainError>(async function* () {
      const whereSpec = yield* TableAggregate.specs().byId(query.tableId).build();
      const tableResult = await handler.tableRepository.findOne(context, whereSpec);
      if (tableResult.isErr()) {
        if (isNotFoundError(tableResult.error)) {
          return err(domainError.notFound({ code: 'table.not_found', message: 'Table not found' }));
        }
        return err(tableResult.error);
      }
      const table = tableResult.value;

      const existingField = yield* table.getField((f) => f.id().equals(query.fieldId));

      // Reuse the command's own parsing for update-input foreign references.
      const command = yield* UpdateFieldCommand.create(
        {
          tableId: query.tableId.toString(),
          fieldId: query.fieldId.toString(),
          field: query.fieldUpdate,
        },
        { allowNoop: true }
      );
      const commandReferences = yield* command.foreignTableReferences();
      const existingReferences = yield* new LinkForeignTableReferenceVisitor().collect([
        existingField,
      ]);
      const allReferences = [...commandReferences];
      for (const ref of existingReferences) {
        if (!allReferences.some((r) => r.foreignTableId.equals(ref.foreignTableId))) {
          allReferences.push(ref);
        }
      }
      const foreignTables = yield* await handler.foreignTableLoaderService.load(context, {
        references: allReferences,
      });

      const updateSpecs = yield* buildUpdateFieldSpecs(existingField, query.fieldUpdate, {
        hostTable: table,
        foreignTables,
        executionContext: context,
      });
      if (updateSpecs.length === 0) {
        return ok(FieldConversionDryRunResult.noop());
      }

      const requiresDataRewrite = updateSpecs.some(fieldUpdateSpecRequiresDataRewrite);
      const isTypeConversion = updateSpecs.some(
        (spec) => spec instanceof TableUpdateFieldTypeSpec && spec.isTypeConversion()
      );

      // Cross-table link side effects only exist when a link field itself is
      // involved; simulate the update on a detached clone to enumerate them.
      let linkSideEffectCount = 0;
      if (existingField instanceof LinkField || query.fieldUpdate.type === 'link') {
        const previewTable = yield* table.clone(handler.tableMapper);
        const previewPreviousField = yield* previewTable.getField((f) =>
          f.id().equals(query.fieldId)
        );
        const previewUpdateResult = yield* previewTable.update((mutator) =>
          mutator.updateField(query.fieldId, updateSpecs, { foreignTables })
        );
        const previewUpdatedField = yield* previewUpdateResult.table.getField((f) =>
          f.id().equals(query.fieldId)
        );
        const sideEffects = yield* collectFieldUpdateAddSideEffects(
          previewTable,
          previewUpdatedField,
          previewPreviousField,
          foreignTables
        );
        linkSideEffectCount = sideEffects.length;
      }

      let affectedCellCount = 0;
      if (requiresDataRewrite) {
        const aggregation = TableRecordAggregation.create(
          [{ fieldId: query.fieldId, statisticFunc: 'filled' }],
          []
        );
        const values = yield* await handler.tableRecordQueryRepository.aggregate(
          context,
          table,
          aggregation
        );
        const filled = values.find(
          (value) => value.statisticFunc === 'filled' && value.fieldId.equals(query.fieldId)
        );
        affectedCellCount = Number(filled?.value ?? 0) || 0;
      }

      return ok(
        FieldConversionDryRunResult.create({
          isNoop: false,
          isTypeConversion,
          requiresDataRewrite,
          affectedCellCount,
          linkSideEffectCount,
        })
      );
    });
  }
}
