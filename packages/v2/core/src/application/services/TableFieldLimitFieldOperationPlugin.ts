import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainContext } from '../../domain/shared/DomainContext';
import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import { ensureTableFieldCountWithinLimit } from '../../domain/table/TableFieldLimit';
import { getDomainContext } from '../../ports/ExecutionContext';
import {
  FieldOperationKind,
  type FieldOperationPluginContext,
  type IFieldOperationPlugin,
} from '../../ports/FieldOperationPlugin';
import {
  createDefaultTableDataSafetyLimitComposer,
  TableDataSafetyLimitComposer,
} from './TableDataSafetyLimitComposer';

type PreparedTableFieldLimitState = {
  readonly domainContext: IDomainContext;
  readonly sourceTable: Table;
};

export class TableFieldLimitFieldOperationPlugin
  implements IFieldOperationPlugin<PreparedTableFieldLimitState>
{
  readonly name = 'table-field-limit';

  constructor(
    private readonly limitComposer: TableDataSafetyLimitComposer = createDefaultTableDataSafetyLimitComposer()
  ) {}

  supports(operation: FieldOperationKind): boolean {
    return operation === FieldOperationKind.create || operation === FieldOperationKind.duplicate;
  }

  async prepare(
    context: FieldOperationPluginContext
  ): Promise<Result<PreparedTableFieldLimitState, DomainError>> {
    const contextLimitsResult = await this.limitComposer.compose(context.executionContext);
    if (contextLimitsResult.isErr()) return err(contextLimitsResult.error);
    const domainContext = getDomainContext(context.executionContext) ?? {};
    return ok({
      domainContext: {
        ...domainContext,
        config: {
          ...(domainContext?.config ?? {}),
          tableLimits: contextLimitsResult.value ?? domainContext?.config?.tableLimits,
        },
      },
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
