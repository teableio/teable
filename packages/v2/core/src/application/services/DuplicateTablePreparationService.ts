import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { classifyPhysicalTableDuplicateSourcePath } from '../../commands/buildPhysicalTableDuplicatePlan';
import type { DuplicateTableCommand } from '../../commands/DuplicateTableCommand';
import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import { FormulaExpression } from '../../domain/table/fields/types/FormulaExpression';
import { FormulaField } from '../../domain/table/fields/types/FormulaField';
import { LinkField } from '../../domain/table/fields/types/LinkField';
import type { Table } from '../../domain/table/Table';
import { getFormulaSourceBudget, type IExecutionContext } from '../../ports/ExecutionContext';
import * as TableMapper from '../../ports/mappers/TableMapper';
import { v2CoreTokens } from '../../ports/tokens';
import { TableQueryService } from './TableQueryService';

export type TableDuplicateLinkDecision = {
  readonly sourceFieldId: string;
  readonly targetFieldId: string;
  readonly foreignTableId: string;
  readonly decision: 'self-remapped' | 'external-preserved-one-way' | 'cross-base-host-policy';
};

export type TableDuplicateRecordCopyPath =
  | { readonly classification: 'none' }
  | { readonly classification: 'hydrated' }
  | {
      readonly classification: 'physical-pending-metadata';
      readonly reason: 'target-physical-metadata-assigned-after-persistence';
    }
  | {
      readonly classification: 'unknown';
      readonly reason: 'source-physical-metadata-unavailable';
    };

/** Internal application facts. Physical plans and database identifiers never cross this seam. */
export type TableDuplicatePreparation = {
  readonly sourceTable: Table;
  readonly duplicatedTable: Table;
  readonly fieldIdMap: ReadonlyMap<string, string>;
  readonly viewIdMap: ReadonlyMap<string, string>;
  readonly linkDecisions: ReadonlyArray<TableDuplicateLinkDecision>;
  readonly includeRecords: boolean;
  readonly recordCopyPath: TableDuplicateRecordCopyPath;
};

export interface IDuplicateTablePreparationService {
  prepare(
    context: IExecutionContext,
    command: DuplicateTableCommand
  ): Promise<Result<TableDuplicatePreparation, DomainError>>;
}

/**
 * Shared read-only preparation for table duplication execution and preview.
 * It reads source metadata and validates formula admission on a detached aggregate, but never
 * runs plugins, persists, builds a physical SQL plan, reads/copies records, publishes events,
 * or enters schema lifecycle.
 */
@injectable()
export class DuplicateTablePreparationService implements IDuplicateTablePreparationService {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: Pick<TableQueryService, 'getByIdInBase'>,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapper.ITableMapper
  ) {}

  async prepare(
    context: IExecutionContext,
    command: DuplicateTableCommand
  ): Promise<Result<TableDuplicatePreparation, DomainError>> {
    const service = this;
    return safeTry<TableDuplicatePreparation, DomainError>(async function* () {
      const sourceTable = yield* await service.tableQueryService.getByIdInBase(
        context,
        command.baseId,
        command.tableId
      );

      for (const field of sourceTable.getFields()) {
        if (!(field instanceof FormulaField)) continue;
        yield* FormulaExpression.create(
          field.expression().toString(),
          getFormulaSourceBudget(context)
        );
      }

      const duplicated = yield* sourceTable.duplicate({
        mapper: service.tableMapper,
        newName: command.name,
      });

      const duplicatedFields = duplicated.table.getFields();
      const linkDecisions: TableDuplicateLinkDecision[] = [];
      for (const sourceField of sourceTable.getFields()) {
        if (!(sourceField instanceof LinkField)) continue;

        const sourceFieldId = sourceField.id().toString();
        const targetFieldId = duplicated.fieldIdMap.get(sourceFieldId);
        if (!targetFieldId) {
          return err(
            domainError.invariant({
              code: 'table.duplicate.field_mapping_missing',
              message: `Duplicated field mapping is missing for ${sourceFieldId}`,
            })
          );
        }
        const targetField = duplicatedFields.find(
          (field) => field.id().toString() === targetFieldId
        );
        if (!(targetField instanceof LinkField)) {
          return err(
            domainError.invariant({
              code: 'table.duplicate.target_link_missing',
              message: `Duplicated link field is missing for mapping ${sourceFieldId}`,
            })
          );
        }

        const isSelfLink = sourceField.foreignTableId().equals(sourceTable.id());
        const foreignBaseId = sourceField.baseId();
        const isCrossBase = !!foreignBaseId && !foreignBaseId.equals(sourceTable.baseId());
        linkDecisions.push({
          sourceFieldId,
          targetFieldId,
          foreignTableId: targetField.foreignTableId().toString(),
          decision: isSelfLink
            ? 'self-remapped'
            : isCrossBase
              ? 'cross-base-host-policy'
              : 'external-preserved-one-way',
        });
      }

      const sourceCopyPath = classifyPhysicalTableDuplicateSourcePath(sourceTable);
      const recordCopyPath: TableDuplicateRecordCopyPath = !command.includeRecords
        ? { classification: 'none' }
        : sourceCopyPath === 'physical-candidate'
          ? {
              classification: 'physical-pending-metadata',
              reason: 'target-physical-metadata-assigned-after-persistence',
            }
          : sourceCopyPath === 'hydrated-required'
            ? { classification: 'hydrated' }
            : {
                classification: 'unknown',
                reason: 'source-physical-metadata-unavailable',
              };

      return ok({
        sourceTable,
        duplicatedTable: duplicated.table,
        fieldIdMap: duplicated.fieldIdMap,
        viewIdMap: duplicated.viewIdMap,
        linkDecisions,
        includeRecords: command.includeRecords,
        recordCopyPath,
      });
    });
  }
}
