import type { Result } from 'neverthrow';
import type { DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';

/** Admission is performed against the complete candidate before metadata or data writes. */
export interface IFormulaAdmissionService {
  admitNew(table: Table): Result<void, DomainError>;
  admitUpdate(
    table: Table,
    mutation: ISpecification<Table, ITableSpecVisitor>
  ): Result<void, DomainError>;
}
