import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import { ensureTableFieldCountWithinLimit } from '../../domain/table/TableFieldLimit';
import { getDomainContext } from '../../ports/ExecutionContext';
import {
  FieldOperationKind,
  type FieldOperationPluginContext,
  type IFieldOperationPlugin,
} from '../../ports/FieldOperationPlugin';

type PreparedTableFieldLimitState = {
  readonly domainContext: ReturnType<typeof getDomainContext>;
  readonly sourceTable: Table;
};

export class TableFieldLimitFieldOperationPlugin
  implements IFieldOperationPlugin<PreparedTableFieldLimitState>
{
  readonly name = 'table-field-limit';

  supports(operation: FieldOperationKind): boolean {
    return operation === FieldOperationKind.create || operation === FieldOperationKind.duplicate;
  }

  prepare(context: FieldOperationPluginContext): Result<PreparedTableFieldLimitState, DomainError> {
    return ok({
      domainContext: getDomainContext(context.executionContext),
      sourceTable: context.table,
    });
  }

  beforePersist(
    _context: FieldOperationPluginContext,
    preparedState: PreparedTableFieldLimitState | undefined
  ): Result<void, DomainError> {
    if (!preparedState) {
      return ok(undefined);
    }

    return ensureTableFieldCountWithinLimit(preparedState.sourceTable, {
      domainContext: preparedState.domainContext,
    });
  }
}
