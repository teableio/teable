import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';

export type SchemaOperationStatus = 'pending' | 'running' | 'ready' | 'error' | 'dead';

export type SchemaOperationType =
  | 'table.provision'
  | 'table.create'
  | 'table.create_many'
  | 'table.update'
  | 'table.delete'
  | 'table.duplicate'
  | 'table.import'
  | (string & Record<never, never>);

export type SchemaOperationPhase =
  | 'pending'
  | 'metadata_pending'
  | 'data_provisioning'
  | 'running'
  | 'ready'
  | 'error'
  | 'deleting'
  | (string & Record<never, never>);

export type SchemaOperationResourceType =
  | 'base'
  | 'table'
  | 'field'
  | 'view'
  | (string & Record<never, never>);

export type SchemaOperationTarget = {
  resourceType: SchemaOperationResourceType;
  resourceId: string;
  baseId?: string;
  tableId?: string;
};

export type SchemaOperationRecord = {
  id: string;
  type: SchemaOperationType;
  status: SchemaOperationStatus;
  phase: SchemaOperationPhase;
  target: SchemaOperationTarget;
  idempotencyKey: string;
  payload?: unknown;
  result?: unknown;
  attempts: number;
  maxAttempts: number;
  nextRunAt: Date;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  lastError?: string | null;
  createdTime: Date;
  createdBy: string;
  lastModifiedTime?: Date | null;
  lastModifiedBy?: string | null;
};

export type SchemaOperationUpsertInput = {
  id?: string;
  type: SchemaOperationType;
  status: SchemaOperationStatus;
  phase: SchemaOperationPhase;
  target: SchemaOperationTarget;
  idempotencyKey: string;
  payload?: unknown;
  result?: unknown;
  lastError?: string | null;
  maxAttempts?: number;
  nextRunAt?: Date;
};

export type SchemaOperationAdvanceInput = {
  status: SchemaOperationStatus;
  phase: SchemaOperationPhase;
  payload?: unknown;
  result?: unknown;
  lastError?: string | null;
  nextRunAt?: Date;
};

export type SchemaOperationClaimInput = {
  lockedBy: string;
  now?: Date;
  staleRunningBefore?: Date;
  types?: ReadonlyArray<SchemaOperationType>;
  phase?: SchemaOperationPhase;
};

export type SchemaOperationListInput = {
  statuses?: ReadonlyArray<SchemaOperationStatus>;
  types?: ReadonlyArray<SchemaOperationType>;
  baseIds?: ReadonlyArray<string>;
  tableIds?: ReadonlyArray<string>;
  resourceIds?: ReadonlyArray<string>;
  limit?: number;
  offset?: number;
};

export type SchemaOperationListResult = {
  items: ReadonlyArray<SchemaOperationRecord>;
  total: number;
};

export type SchemaOperationSelector =
  | {
      id: string;
      idempotencyKey?: never;
    }
  | {
      id?: never;
      idempotencyKey: string;
    };

export type SchemaOperationManualRetryInput = {
  selector: SchemaOperationSelector;
  now?: Date;
  resetAttempts?: boolean;
  lastError?: string | null;
};

export type SchemaOperationMarkDeadInput = {
  selector: SchemaOperationSelector;
  now?: Date;
  reason?: string | null;
};

export interface ISchemaOperationRepository {
  upsert(
    context: IExecutionContext,
    input: SchemaOperationUpsertInput
  ): Promise<Result<SchemaOperationRecord, DomainError>>;
  advance(
    context: IExecutionContext,
    idempotencyKey: string,
    input: SchemaOperationAdvanceInput
  ): Promise<Result<SchemaOperationRecord, DomainError>>;
  claimNextRunnable?(
    context: IExecutionContext,
    input: SchemaOperationClaimInput
  ): Promise<Result<SchemaOperationRecord | undefined, DomainError>>;
  findOpenByTarget?(
    context: IExecutionContext,
    target: SchemaOperationTarget
  ): Promise<Result<ReadonlyArray<SchemaOperationRecord>, DomainError>>;
  list(
    context: IExecutionContext,
    input?: SchemaOperationListInput
  ): Promise<Result<SchemaOperationListResult, DomainError>>;
  manualRetry(
    context: IExecutionContext,
    input: SchemaOperationManualRetryInput
  ): Promise<Result<SchemaOperationRecord, DomainError>>;
  markDead(
    context: IExecutionContext,
    input: SchemaOperationMarkDeadInput
  ): Promise<Result<SchemaOperationRecord, DomainError>>;
}
