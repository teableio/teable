import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { TableRecord } from '../TableRecord';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';

export type IncomingLinkSelectedMode = 'currentColumnNotNull' | 'hostReferenceExists';

/**
 * A condition over the host (link-owning) table's records. When set, only foreign
 * records referenced by a host record satisfying it are selected, so a shared
 * view's link picker cannot list records linked from rows the view filter hides.
 */
export type IncomingLinkHostCondition = ISpecification<
  TableRecord,
  ITableRecordConditionSpecVisitor
>;

export class IncomingLinkSelectedSpec<
  V extends ITableRecordConditionSpecVisitor = ITableRecordConditionSpecVisitor,
> implements ISpecification<TableRecord, V>
{
  private constructor(
    private readonly modeValue: IncomingLinkSelectedMode,
    private readonly selfKeyNameValue: string,
    private readonly fkHostTableNameValue?: string,
    private readonly foreignKeyNameValue?: string,
    private readonly hostTableNameValue?: string,
    private readonly hostConditionValue?: IncomingLinkHostCondition
  ) {}

  static create(params: {
    mode: IncomingLinkSelectedMode;
    selfKeyName: string;
    fkHostTableName?: string;
    foreignKeyName?: string;
    hostTableName?: string;
    hostCondition?: IncomingLinkHostCondition;
  }): IncomingLinkSelectedSpec {
    return new IncomingLinkSelectedSpec(
      params.mode,
      params.selfKeyName,
      params.fkHostTableName,
      params.foreignKeyName,
      params.hostTableName,
      params.hostCondition
    );
  }

  mode(): IncomingLinkSelectedMode {
    return this.modeValue;
  }

  selfKeyName(): string {
    return this.selfKeyNameValue;
  }

  fkHostTableName(): string | undefined {
    return this.fkHostTableNameValue;
  }

  foreignKeyName(): string | undefined {
    return this.foreignKeyNameValue;
  }

  hostTableName(): string | undefined {
    return this.hostTableNameValue;
  }

  hostCondition(): IncomingLinkHostCondition | undefined {
    return this.hostConditionValue;
  }

  isSatisfiedBy(_record: TableRecord): boolean {
    return false;
  }

  mutate(record: TableRecord): Result<TableRecord, DomainError> {
    return ok(record);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitIncomingLinkSelected(this).map(() => undefined);
  }
}
