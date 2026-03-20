import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { RecordId } from '../RecordId';
import type { TableRecord } from '../TableRecord';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';

export type IncomingLinkCandidateMode =
  | 'currentColumnAvailable'
  | 'hostReferenceAvailable'
  | 'junctionReferenceAvailable';

export class IncomingLinkCandidateSpec<
  V extends ITableRecordConditionSpecVisitor = ITableRecordConditionSpecVisitor,
> implements ISpecification<TableRecord, V>
{
  private constructor(
    private readonly modeValue: IncomingLinkCandidateMode,
    private readonly selfKeyNameValue: string,
    private readonly hostRecordIdValue?: RecordId,
    private readonly fkHostTableNameValue?: string,
    private readonly foreignKeyNameValue?: string
  ) {}

  static create(params: {
    mode: IncomingLinkCandidateMode;
    selfKeyName: string;
    hostRecordId?: RecordId;
    fkHostTableName?: string;
    foreignKeyName?: string;
  }): IncomingLinkCandidateSpec {
    return new IncomingLinkCandidateSpec(
      params.mode,
      params.selfKeyName,
      params.hostRecordId,
      params.fkHostTableName,
      params.foreignKeyName
    );
  }

  mode(): IncomingLinkCandidateMode {
    return this.modeValue;
  }

  selfKeyName(): string {
    return this.selfKeyNameValue;
  }

  hostRecordId(): RecordId | undefined {
    return this.hostRecordIdValue;
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
    return v.visitIncomingLinkCandidate(this).map(() => undefined);
  }
}
