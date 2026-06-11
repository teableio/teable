import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { TableRecord } from '../TableRecord';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';

export type IncomingLinkSelectedMode = 'currentColumnNotNull' | 'hostReferenceExists';

export class IncomingLinkSelectedSpec<
  V extends ITableRecordConditionSpecVisitor = ITableRecordConditionSpecVisitor,
> implements ISpecification<TableRecord, V>
{
  private constructor(
    private readonly modeValue: IncomingLinkSelectedMode,
    private readonly selfKeyNameValue: string,
    private readonly fkHostTableNameValue?: string,
    private readonly foreignKeyNameValue?: string
  ) {}

  static create(params: {
    mode: IncomingLinkSelectedMode;
    selfKeyName: string;
    fkHostTableName?: string;
    foreignKeyName?: string;
  }): IncomingLinkSelectedSpec {
    return new IncomingLinkSelectedSpec(
      params.mode,
      params.selfKeyName,
      params.fkHostTableName,
      params.foreignKeyName
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
