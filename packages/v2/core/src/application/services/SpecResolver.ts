import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { ICellValueSpec } from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { IExecutionContext } from '../../ports/ExecutionContext';

export interface ICellValueSpecResolver<TSpec extends ICellValueSpec = ICellValueSpec> {
  supports(spec: ICellValueSpec): spec is TSpec;
  resolveSpecs(
    context: IExecutionContext,
    specs: ReadonlyArray<TSpec>
  ): Promise<Result<ReadonlyArray<ICellValueSpec>, DomainError>>;
}
