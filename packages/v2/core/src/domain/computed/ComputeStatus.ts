import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../shared/DomainError';
import { ValueObject } from '../shared/ValueObject';

export const FIELD_COMPUTE_STATUSES = ['idle', 'queued', 'running', 'failed'] as const;
export type FieldComputeStatusValue = (typeof FIELD_COMPUTE_STATUSES)[number];

export const TABLE_COMPUTE_STATUSES = ['idle', 'calculating'] as const;
export type TableComputeStatusValue = (typeof TABLE_COMPUTE_STATUSES)[number];

const fieldComputeStatusSchema = z.enum(FIELD_COMPUTE_STATUSES);
const tableComputeStatusSchema = z.enum(TABLE_COMPUTE_STATUSES);

export class FieldComputeStatus extends ValueObject {
  private constructor(private readonly value: FieldComputeStatusValue) {
    super();
  }

  static create(raw: unknown): Result<FieldComputeStatus, DomainError> {
    const parsed = fieldComputeStatusSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid FieldComputeStatus' }));
    }
    return ok(new FieldComputeStatus(parsed.data));
  }

  static idle(): FieldComputeStatus {
    return new FieldComputeStatus('idle');
  }

  static queued(): FieldComputeStatus {
    return new FieldComputeStatus('queued');
  }

  static running(): FieldComputeStatus {
    return new FieldComputeStatus('running');
  }

  static failed(): FieldComputeStatus {
    return new FieldComputeStatus('failed');
  }

  static fromActive(params: {
    activeTaskCount: number;
    processingTaskCount: number;
    failed?: boolean;
  }): FieldComputeStatus {
    if (params.activeTaskCount <= 0) {
      return params.failed ? FieldComputeStatus.failed() : FieldComputeStatus.idle();
    }
    if (params.processingTaskCount > 0) {
      return FieldComputeStatus.running();
    }
    return FieldComputeStatus.queued();
  }

  equals(other: FieldComputeStatus): boolean {
    return this.value === other.value;
  }

  isActive(): boolean {
    return this.value === 'queued' || this.value === 'running';
  }

  toString(): FieldComputeStatusValue {
    return this.value;
  }
}

export class TableComputeStatus extends ValueObject {
  private constructor(private readonly value: TableComputeStatusValue) {
    super();
  }

  static create(raw: unknown): Result<TableComputeStatus, DomainError> {
    const parsed = tableComputeStatusSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid TableComputeStatus' }));
    }
    return ok(new TableComputeStatus(parsed.data));
  }

  static idle(): TableComputeStatus {
    return new TableComputeStatus('idle');
  }

  static calculating(): TableComputeStatus {
    return new TableComputeStatus('calculating');
  }

  static fromActiveFieldCount(activeFieldCount: number): TableComputeStatus {
    return activeFieldCount > 0 ? TableComputeStatus.calculating() : TableComputeStatus.idle();
  }

  equals(other: TableComputeStatus): boolean {
    return this.value === other.value;
  }

  isCalculating(): boolean {
    return this.value === 'calculating';
  }

  toString(): TableComputeStatusValue {
    return this.value;
  }
}
