import type { Result } from 'neverthrow';
import type { BaseId } from '../domain/base/BaseId';
import type { DomainError } from '../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { TableId } from '../domain/table/TableId';

export abstract class TableUpdateCommand {
  constructor(
    public readonly baseId: BaseId,
    public readonly tableId: TableId
  ) {}
  foreignTableReferences?(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError>;
}
