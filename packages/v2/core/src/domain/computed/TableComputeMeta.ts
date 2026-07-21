import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../base/BaseId';
import { domainError, type DomainError } from '../shared/DomainError';
import type { FieldId } from '../table/fields/FieldId';
import { TableId } from '../table/TableId';
import { TableComputeStatus, type TableComputeStatusValue } from './ComputeStatus';

const recentCompletionSchema = z.object({
  fieldId: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  completedAt: z.string().datetime(),
});

const tableComputeMetaSchema = z.object({
  tableId: z.string().min(1),
  baseId: z.string().min(1),
  status: z.enum(['idle', 'calculating']),
  calculatingFieldCount: z.number().int().nonnegative(),
  queuedFieldCount: z.number().int().nonnegative(),
  estimatedComplexity: z.number().int().nonnegative(),
  recentCompletions: z.array(recentCompletionSchema),
  generation: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  computeMode: z.literal('server'),
});

export type TableComputeRecentCompletion = {
  fieldId: string;
  durationMs: number;
  completedAt: string;
};

export type TableComputeMetaDto = {
  tableId: string;
  baseId: string;
  status: TableComputeStatusValue;
  calculatingFieldCount: number;
  queuedFieldCount: number;
  estimatedComplexity: number;
  recentCompletions: TableComputeRecentCompletion[];
  generation: number;
  updatedAt: string;
  computeMode: 'server';
};

const DEFAULT_RECENT_LIMIT = 20;

export class TableComputeMeta {
  private constructor(
    private state: TableComputeMetaDto,
    private readonly tableIdValue: TableId,
    private readonly baseIdValue: BaseId
  ) {}

  static create(raw: unknown): Result<TableComputeMeta, DomainError> {
    const parsed = tableComputeMetaSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid TableComputeMeta' }));
    }
    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map(
        (tableId) => new TableComputeMeta(parsed.data, tableId, baseId)
      )
    );
  }

  static idle(params: { tableId: TableId; baseId: BaseId; now?: Date }): TableComputeMeta {
    const now = (params.now ?? new Date()).toISOString();
    return new TableComputeMeta(
      {
        tableId: params.tableId.toString(),
        baseId: params.baseId.toString(),
        status: 'idle',
        calculatingFieldCount: 0,
        queuedFieldCount: 0,
        estimatedComplexity: 0,
        recentCompletions: [],
        generation: 0,
        updatedAt: now,
        computeMode: 'server',
      },
      params.tableId,
      params.baseId
    );
  }

  static fromDto(dto: TableComputeMetaDto): Result<TableComputeMeta, DomainError> {
    return TableComputeMeta.create(dto);
  }

  toDto(): TableComputeMetaDto {
    return {
      ...this.state,
      tableId: this.tableIdValue.toString(),
      baseId: this.baseIdValue.toString(),
      recentCompletions: [...this.state.recentCompletions],
    };
  }

  toPublicDto(): {
    status: TableComputeStatusValue;
    calculatingFieldCount: number;
    queuedFieldCount: number;
    estimatedComplexity?: number;
    recentCompletions: TableComputeRecentCompletion[];
    computeMode: 'server';
  } {
    return {
      status: this.state.status,
      calculatingFieldCount: this.state.calculatingFieldCount,
      queuedFieldCount: this.state.queuedFieldCount,
      estimatedComplexity: this.state.estimatedComplexity || undefined,
      recentCompletions: [...this.state.recentCompletions],
      computeMode: 'server',
    };
  }

  tableId(): TableId {
    return this.tableIdValue;
  }

  baseId(): BaseId {
    return this.baseIdValue;
  }

  status(): TableComputeStatus {
    return TableComputeStatus.create(this.state.status)._unsafeUnwrap();
  }

  /**
   * Recompute table-level counters from field activity snapshots.
   */
  recomputeFromFields(
    fields: ReadonlyArray<{
      status: string;
      estimatedComplexity: number;
    }>,
    now?: Date
  ): void {
    const ts = now ?? new Date();
    let calculating = 0;
    let queued = 0;
    let complexity = 0;
    for (const field of fields) {
      if (field.status === 'running') {
        calculating += 1;
        complexity = Math.max(complexity, field.estimatedComplexity);
      } else if (field.status === 'queued') {
        queued += 1;
        complexity = Math.max(complexity, field.estimatedComplexity);
      }
    }
    this.state.calculatingFieldCount = calculating;
    this.state.queuedFieldCount = queued;
    this.state.estimatedComplexity = complexity;
    this.state.status = TableComputeStatus.fromActiveFieldCount(calculating + queued).toString();
    this.state.generation += 1;
    this.state.updatedAt = ts.toISOString();
  }

  pushCompletion(
    completion: Omit<TableComputeRecentCompletion, 'fieldId'> & { fieldId: FieldId },
    options?: { limit?: number; now?: Date }
  ): void {
    const limit = options?.limit ?? DEFAULT_RECENT_LIMIT;
    const now = options?.now ?? new Date();
    this.state.recentCompletions = [
      { ...completion, fieldId: completion.fieldId.toString() },
      ...this.state.recentCompletions,
    ].slice(0, limit);
    this.state.updatedAt = now.toISOString();
  }
}
