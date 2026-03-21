import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { composeAndSpecsOrUndefined } from '../../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { RecordId } from '../../domain/table/records/RecordId';
import { RecordByIdsSpec } from '../../domain/table/records/specs/RecordByIdsSpec';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';

export type RecordConditionSpec = ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;

export const composeRecordConditionSpecs = (
  ...specs: ReadonlyArray<RecordConditionSpec | undefined>
): RecordConditionSpec | undefined =>
  composeAndSpecsOrUndefined(specs.filter((spec): spec is RecordConditionSpec => spec != null));

export const ensureRecordIdsWithinScope = async (
  context: IExecutionContext,
  table: Table,
  recordIds: ReadonlyArray<RecordId>,
  scopeSpec: RecordConditionSpec | undefined,
  queryRepository: ITableRecordQueryRepository,
  operation: string
): Promise<Result<void, DomainError>> => {
  if (!scopeSpec || recordIds.length === 0) {
    return ok(undefined);
  }

  const scopedSpec = composeRecordConditionSpecs(RecordByIdsSpec.create(recordIds), scopeSpec);
  if (!scopedSpec) {
    return ok(undefined);
  }

  const queryResult = await queryRepository.find(context, table, scopedSpec, {
    mode: 'stored',
    includeTotal: false,
  });
  if (queryResult.isErr()) {
    return err(queryResult.error);
  }

  const authorizedIds = new Set(queryResult.value.records.map((record) => record.id));
  const hasUnauthorizedTarget = recordIds.some(
    (recordId) => !authorizedIds.has(recordId.toString())
  );
  if (!hasUnauthorizedTarget) {
    return ok(undefined);
  }

  return err(
    domainError.forbidden({
      code: 'record_write_plugin.scope_forbidden',
      message: 'Record write target includes rows outside the allowed scope.',
      details: {
        operation,
        tableId: table.id().toString(),
        requestedRecordCount: recordIds.length,
        authorizedRecordCount: queryResult.value.records.length,
      },
    })
  );
};
