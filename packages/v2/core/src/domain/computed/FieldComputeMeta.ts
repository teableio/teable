import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../base/BaseId';
import { domainError, type DomainError } from '../shared/DomainError';
import { FieldId } from '../table/fields/FieldId';
import { TableId } from '../table/TableId';
import { FieldComputeStatus, type FieldComputeStatusValue } from './ComputeStatus';

const lastErrorSchema = z
  .object({
    code: z.string().optional(),
    message: z.string(),
  })
  .nullable()
  .optional();

const fieldComputeMetaSchema = z.object({
  fieldId: z.string().min(1),
  tableId: z.string().min(1),
  baseId: z.string().min(1),
  status: z.enum(['idle', 'queued', 'running', 'failed']),
  activeTaskCount: z.number().int().nonnegative(),
  processingTaskCount: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
  estimatedComplexity: z.number().int().nonnegative(),
  estimatedDirtyRecords: z.number().int().nonnegative(),
  hasAllTargetRecords: z.boolean(),
  queuedAt: z.string().datetime().optional().nullable(),
  startedAt: z.string().datetime().optional().nullable(),
  updatedAt: z.string().datetime(),
  lastCompletedAt: z.string().datetime().optional().nullable(),
  lastDurationMs: z.number().int().nonnegative().optional().nullable(),
  lastError: lastErrorSchema,
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type FieldComputeMetaDto = {
  fieldId: string;
  tableId: string;
  baseId: string;
  status: FieldComputeStatusValue;
  activeTaskCount: number;
  processingTaskCount: number;
  generation: number;
  estimatedComplexity: number;
  estimatedDirtyRecords: number;
  hasAllTargetRecords: boolean;
  queuedAt?: string | null;
  startedAt?: string | null;
  updatedAt: string;
  lastCompletedAt?: string | null;
  lastDurationMs?: number | null;
  lastError?: { code?: string; message: string } | null;
  extensions?: Record<string, unknown>;
};

export type FieldComputeBatchProgress = {
  total: number;
  completed: number;
};

export type FieldComputeBatch = FieldComputeBatchProgress & {
  groupId: string;
};

type StoredFieldComputeBatchProgress = FieldComputeBatchProgress & {
  groupId?: string;
};

const readBatchProgressExtension = (
  extensions: Record<string, unknown> | undefined
): StoredFieldComputeBatchProgress | undefined => {
  const value = extensions?.batchProgress;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { total, completed, groupId } = value as Record<string, unknown>;
  if (
    typeof total !== 'number' ||
    !Number.isInteger(total) ||
    total < 0 ||
    typeof completed !== 'number' ||
    !Number.isInteger(completed) ||
    completed < 0
  ) {
    return undefined;
  }
  return {
    total,
    completed: Math.min(total, completed),
    ...(typeof groupId === 'string' ? { groupId } : {}),
  };
};

export const getFieldComputeBatchProgress = (
  field: Pick<FieldComputeMetaDto, 'status' | 'activeTaskCount' | 'extensions'>
): FieldComputeBatchProgress | undefined => {
  if (field.status === 'idle') return undefined;
  const stored = readBatchProgressExtension(field.extensions);
  const total = Math.max(field.activeTaskCount, stored?.total ?? 0);
  if (total === 0) return undefined;
  return { total, completed: Math.min(total, stored?.completed ?? 0) };
};

export type FieldComputeTarget = {
  fieldId: FieldId;
  tableId: TableId;
};

const MAX_RECENT = 0; // field meta does not keep recent list

/**
 * Pure projection of a field's compute activity.
 * Mutable in-memory aggregate used by the computed activity projector.
 */
export class FieldComputeMeta {
  private constructor(
    private state: FieldComputeMetaDto,
    private readonly fieldIdValue: FieldId,
    private readonly tableIdValue: TableId,
    private readonly baseIdValue: BaseId
  ) {}

  static create(raw: unknown): Result<FieldComputeMeta, DomainError> {
    const parsed = fieldComputeMetaSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid FieldComputeMeta' }));
    }
    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).andThen((tableId) =>
        FieldId.create(parsed.data.fieldId).map(
          (fieldId) => new FieldComputeMeta(parsed.data, fieldId, tableId, baseId)
        )
      )
    );
  }

  static idle(params: {
    fieldId: FieldId;
    tableId: TableId;
    baseId: BaseId;
    now?: Date;
  }): FieldComputeMeta {
    const now = (params.now ?? new Date()).toISOString();
    return new FieldComputeMeta(
      {
        fieldId: params.fieldId.toString(),
        tableId: params.tableId.toString(),
        baseId: params.baseId.toString(),
        status: 'idle',
        activeTaskCount: 0,
        processingTaskCount: 0,
        generation: 0,
        estimatedComplexity: 0,
        estimatedDirtyRecords: 0,
        hasAllTargetRecords: false,
        updatedAt: now,
      },
      params.fieldId,
      params.tableId,
      params.baseId
    );
  }

  static fromDto(dto: FieldComputeMetaDto): Result<FieldComputeMeta, DomainError> {
    return FieldComputeMeta.create(dto);
  }

  toDto(): FieldComputeMetaDto {
    return {
      ...this.state,
      fieldId: this.fieldIdValue.toString(),
      tableId: this.tableIdValue.toString(),
      baseId: this.baseIdValue.toString(),
      extensions: this.state.extensions ? { ...this.state.extensions } : undefined,
    };
  }

  /** Public read-model subset for field DTO. */
  toPublicDto(): {
    status: FieldComputeStatusValue;
    estimatedComplexity?: number;
    estimatedDirtyRecords?: number;
    startedAt?: string;
    lastDurationMs?: number;
    lastError?: { code?: string; message: string } | null;
  } {
    return {
      status: this.state.status,
      estimatedComplexity: this.state.estimatedComplexity || undefined,
      estimatedDirtyRecords: this.state.estimatedDirtyRecords || undefined,
      startedAt: this.state.startedAt ?? undefined,
      lastDurationMs: this.state.lastDurationMs ?? undefined,
      lastError: this.state.lastError ?? undefined,
    };
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  tableId(): TableId {
    return this.tableIdValue;
  }

  baseId(): BaseId {
    return this.baseIdValue;
  }

  status(): FieldComputeStatus {
    return FieldComputeStatus.create(this.state.status)._unsafeUnwrap();
  }

  isActive(): boolean {
    return this.state.activeTaskCount > 0;
  }

  /**
   * Attach a task reference (enqueue). Idempotent for the same task is handled by the store.
   * This method only mutates counters once per successful attach.
   */
  attachTask(params: {
    estimatedComplexity: number;
    estimatedDirtyRecords: number;
    hasAllTargetRecords: boolean;
    batchProgress?: FieldComputeBatch;
    now?: Date;
  }): void {
    const now = params.now ?? new Date();
    const iso = now.toISOString();
    if (params.batchProgress) {
      const total = Math.max(1, Math.trunc(params.batchProgress.total));
      const completed = Math.max(0, Math.min(total, Math.trunc(params.batchProgress.completed)));
      this.setBatchProgress({
        groupId: params.batchProgress.groupId,
        total,
        completed,
      });
    } else {
      const currentProgress = getFieldComputeBatchProgress(this.state) ?? {
        total: this.state.activeTaskCount,
        completed: 0,
      };
      this.setBatchProgress(
        this.state.activeTaskCount === 0
          ? { total: 1, completed: 0 }
          : { total: currentProgress.total + 1, completed: currentProgress.completed }
      );
    }
    this.state.activeTaskCount += 1;
    this.state.estimatedComplexity = Math.max(
      this.state.estimatedComplexity,
      Math.max(0, Math.trunc(params.estimatedComplexity))
    );
    this.state.estimatedDirtyRecords = Math.max(
      this.state.estimatedDirtyRecords,
      Math.max(0, Math.trunc(params.estimatedDirtyRecords))
    );
    this.state.hasAllTargetRecords =
      this.state.hasAllTargetRecords || params.hasAllTargetRecords === true;
    if (!this.state.queuedAt) {
      this.state.queuedAt = iso;
    }
    this.state.lastError = null;
    this.recomputeStatus(now);
  }

  markProcessing(params?: { now?: Date }): void {
    const now = params?.now ?? new Date();
    if (this.state.processingTaskCount < this.state.activeTaskCount) {
      this.state.processingTaskCount += 1;
    }
    if (!this.state.startedAt) {
      this.state.startedAt = now.toISOString();
    }
    this.recomputeStatus(now);
  }

  reconcileProcessing(params: {
    processingTaskCount: number;
    lastError?: { code?: string; message: string } | null;
    now?: Date;
  }): void {
    const now = params.now ?? new Date();
    this.state.processingTaskCount = Math.min(
      this.state.activeTaskCount,
      Math.max(0, Math.trunc(params.processingTaskCount))
    );
    if (params.lastError !== undefined) {
      this.state.lastError = params.lastError;
    }
    if (this.state.processingTaskCount > 0 && !this.state.startedAt) {
      this.state.startedAt = now.toISOString();
    }
    this.recomputeStatus(now);
  }

  /**
   * Release one task reference (done / dropped).
   */
  releaseTask(params: {
    wasProcessing: boolean;
    durationMs?: number;
    error?: { code?: string; message: string } | null;
    now?: Date;
  }): void {
    const now = params.now ?? new Date();
    const storedProgress = readBatchProgressExtension(this.state.extensions);
    if (this.state.activeTaskCount > 0 && !storedProgress?.groupId) {
      const currentProgress = getFieldComputeBatchProgress(this.state) ?? {
        total: this.state.activeTaskCount,
        completed: 0,
      };
      this.setBatchProgress({
        total: currentProgress.total,
        completed: Math.min(currentProgress.total, currentProgress.completed + 1),
      });
    }
    this.state.activeTaskCount = Math.max(0, this.state.activeTaskCount - 1);
    if (params.wasProcessing) {
      this.state.processingTaskCount = Math.max(0, this.state.processingTaskCount - 1);
    }
    if (params.error) {
      this.state.lastError = params.error;
    } else if (this.state.activeTaskCount === 0) {
      this.state.lastError = null;
    }
    if (params.durationMs != null && params.durationMs >= 0) {
      this.state.lastDurationMs = Math.trunc(params.durationMs);
      this.state.lastCompletedAt = now.toISOString();
    }
    if (this.state.activeTaskCount === 0) {
      this.state.estimatedComplexity = 0;
      this.state.estimatedDirtyRecords = 0;
      this.state.hasAllTargetRecords = false;
      this.state.queuedAt = null;
      this.state.startedAt = null;
      this.state.processingTaskCount = 0;
    }
    this.recomputeStatus(now, params.error != null && this.state.activeTaskCount === 0);
  }

  private setBatchProgress(progress: StoredFieldComputeBatchProgress): void {
    this.state.extensions = {
      ...this.state.extensions,
      batchProgress: progress,
    };
  }

  private recomputeStatus(now: Date, failed = false): void {
    const status = FieldComputeStatus.fromActive({
      activeTaskCount: this.state.activeTaskCount,
      processingTaskCount: this.state.processingTaskCount,
      failed,
    });
    this.state.status = status.toString();
    this.state.generation += 1;
    this.state.updatedAt = now.toISOString();
    void MAX_RECENT;
  }
}
