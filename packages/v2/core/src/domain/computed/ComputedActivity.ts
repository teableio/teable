import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../base/BaseId';
import type { DomainError } from '../shared/DomainError';
import type { FieldId } from '../table/fields/FieldId';
import type { TableId } from '../table/TableId';
import type {
  FieldComputeBatch,
  FieldComputeMeta,
  FieldComputeMetaDto,
  FieldComputeTarget,
} from './FieldComputeMeta';
import { FieldComputeMeta as FieldComputeMetaClass } from './FieldComputeMeta';
import type { TableComputeMeta, TableComputeMetaDto } from './TableComputeMeta';
import { TableComputeMeta as TableComputeMetaClass } from './TableComputeMeta';

export type ComputedActivitySnapshot = {
  fields: FieldComputeMetaDto[];
  tables: TableComputeMetaDto[];
};

/**
 * In-memory computed activity workspace for pure transitions.
 * Persistence adapters load/save snapshots; domain logic stays here.
 */
export class ComputedActivity {
  private readonly fields = new Map<string, FieldComputeMeta>();
  private readonly tables = new Map<string, TableComputeMeta>();

  static empty(): ComputedActivity {
    return new ComputedActivity();
  }

  static fromSnapshot(snapshot: ComputedActivitySnapshot): Result<ComputedActivity, DomainError> {
    const activity = new ComputedActivity();
    for (const fieldDto of snapshot.fields) {
      const field = FieldComputeMetaClass.fromDto(fieldDto);
      if (field.isErr()) return err(field.error);
      activity.fields.set(field.value.fieldId().toString(), field.value);
    }
    for (const tableDto of snapshot.tables) {
      const table = TableComputeMetaClass.fromDto(tableDto);
      if (table.isErr()) return err(table.error);
      activity.tables.set(table.value.tableId().toString(), table.value);
    }
    return ok(activity);
  }

  getField(fieldId: FieldId): FieldComputeMeta | undefined {
    return this.fields.get(fieldId.toString());
  }

  getTable(tableId: TableId): TableComputeMeta | undefined {
    return this.tables.get(tableId.toString());
  }

  ensureField(params: {
    fieldId: FieldId;
    tableId: TableId;
    baseId: BaseId;
    now?: Date;
  }): FieldComputeMeta {
    const key = params.fieldId.toString();
    const existing = this.fields.get(key);
    if (existing) return existing;
    const created = FieldComputeMetaClass.idle(params);
    this.fields.set(key, created);
    return created;
  }

  ensureTable(params: { tableId: TableId; baseId: BaseId; now?: Date }): TableComputeMeta {
    const key = params.tableId.toString();
    const existing = this.tables.get(key);
    if (existing) return existing;
    const created = TableComputeMetaClass.idle(params);
    this.tables.set(key, created);
    return created;
  }

  attachTask(params: {
    baseId: BaseId;
    targets: ReadonlyArray<FieldComputeTarget>;
    estimatedComplexity: number;
    estimatedDirtyRecords: number;
    hasAllTargetRecords: boolean;
    batchProgress?: FieldComputeBatch;
    now?: Date;
  }): void {
    const now = params.now ?? new Date();
    const touchedTables = new Map<string, TableId>();
    for (const target of params.targets) {
      const field = this.ensureField({ ...target, baseId: params.baseId, now });
      field.attachTask({
        estimatedComplexity: params.estimatedComplexity,
        estimatedDirtyRecords: params.estimatedDirtyRecords,
        hasAllTargetRecords: params.hasAllTargetRecords,
        batchProgress: params.batchProgress,
        now,
      });
      touchedTables.set(target.tableId.toString(), target.tableId);
    }
    this.recomputeTables(params.baseId, touchedTables.values(), now);
  }

  markProcessing(params: {
    baseId: BaseId;
    targets: ReadonlyArray<FieldComputeTarget>;
    now?: Date;
  }): void {
    const now = params.now ?? new Date();
    const touchedTables = new Map<string, TableId>();
    for (const target of params.targets) {
      const field = this.ensureField({ ...target, baseId: params.baseId, now });
      field.markProcessing({ now });
      touchedTables.set(target.tableId.toString(), target.tableId);
    }
    this.recomputeTables(params.baseId, touchedTables.values(), now);
  }

  reconcileProcessing(params: {
    targets: ReadonlyArray<
      FieldComputeTarget & {
        baseId: BaseId;
        processingTaskCount: number;
      }
    >;
    lastError?: { code?: string; message: string } | null;
    now?: Date;
  }): void {
    const now = params.now ?? new Date();
    const touchedTables = new Map<string, { tableId: TableId; baseId: BaseId }>();
    for (const target of params.targets) {
      const field = this.ensureField({ ...target, now });
      field.reconcileProcessing({
        processingTaskCount: target.processingTaskCount,
        lastError: params.lastError,
        now,
      });
      touchedTables.set(target.tableId.toString(), target);
    }
    for (const { tableId, baseId } of touchedTables.values()) {
      this.recomputeTables(baseId, [tableId], now);
    }
  }

  releaseTask(params: {
    baseId: BaseId;
    targets: ReadonlyArray<FieldComputeTarget>;
    wasProcessing: boolean;
    durationMs?: number;
    error?: { code?: string; message: string } | null;
    now?: Date;
  }): void {
    const now = params.now ?? new Date();
    const touchedTables = new Map<string, TableId>();
    for (const target of params.targets) {
      const field = this.ensureField({ ...target, baseId: params.baseId, now });
      field.releaseTask({
        wasProcessing: params.wasProcessing,
        durationMs: params.durationMs,
        error: params.error,
        now,
      });
      if (params.durationMs != null && params.durationMs >= 0 && !params.error) {
        const table = this.ensureTable({
          tableId: target.tableId,
          baseId: params.baseId,
          now,
        });
        table.pushCompletion(
          {
            fieldId: target.fieldId,
            durationMs: Math.trunc(params.durationMs),
            completedAt: now.toISOString(),
          },
          { now }
        );
      }
      touchedTables.set(target.tableId.toString(), target.tableId);
    }
    this.recomputeTables(params.baseId, touchedTables.values(), now);
  }

  snapshot(): ComputedActivitySnapshot {
    return {
      fields: [...this.fields.values()].map((field) => field.toDto()),
      tables: [...this.tables.values()].map((table) => table.toDto()),
    };
  }

  private recomputeTables(baseId: BaseId, tableIds: Iterable<TableId>, now: Date): void {
    for (const tableId of tableIds) {
      const table = this.ensureTable({ tableId, baseId, now });
      const fields = [...this.fields.values()]
        .filter((field) => field.tableId().equals(tableId))
        .map((field) => field.toDto());
      table.recomputeFromFields(fields, now);
    }
  }
}
