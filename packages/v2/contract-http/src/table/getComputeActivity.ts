import {
  getFieldComputeBatchProgress,
  type DomainError,
  type IGetComputeActivityQueryInput,
  type TableComputeActivitySnapshot,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
} from '../shared/http';
import { fieldComputeMetaDtoSchema, tableComputeMetaDtoSchema } from './dto';

export type IGetComputeActivityRequestDto = IGetComputeActivityQueryInput;

export const computeActivityAnomalySchema = z.object({
  fieldId: z.string(),
  kind: z.enum(['failed', 'high_complexity', 'all_target_records', 'stale']),
  message: z.string(),
  estimatedComplexity: z.number().optional(),
});

export const computeActivityDiagnosticsSchema = z.object({
  computeMode: z.literal('server'),
  activeFieldCount: z.number(),
  queuedFieldCount: z.number(),
  calculatingFieldCount: z.number(),
  failedFieldCount: z.number(),
  highComplexityFieldCount: z.number(),
  anomalies: z.array(computeActivityAnomalySchema),
});

export const getComputeActivityResponseDataSchema = z.object({
  tableId: z.string(),
  baseId: z.string(),
  table: tableComputeMetaDtoSchema
    .extend({
      generation: z.number().optional(),
      updatedAt: z.string().optional(),
    })
    .nullable(),
  fields: z.array(
    fieldComputeMetaDtoSchema.extend({
      fieldId: z.string(),
      tableId: z.string().optional(),
      baseId: z.string().optional(),
      activeTaskCount: z.number().optional(),
      processingTaskCount: z.number().optional(),
      generation: z.number().optional(),
      hasAllTargetRecords: z.boolean().optional(),
      queuedAt: z.string().nullable().optional(),
      updatedAt: z.string().optional(),
      lastCompletedAt: z.string().nullable().optional(),
      batchProgress: z
        .object({
          total: z.number().int().nonnegative(),
          completed: z.number().int().nonnegative(),
        })
        .optional(),
    })
  ),
  diagnostics: computeActivityDiagnosticsSchema,
});

export type IGetComputeActivityResponseDataDto = z.infer<
  typeof getComputeActivityResponseDataSchema
>;

export type IGetComputeActivityResponseDto = IApiResponseDto<IGetComputeActivityResponseDataDto>;
export type IGetComputeActivityOkResponseDto =
  IApiOkResponseDto<IGetComputeActivityResponseDataDto>;
export type IGetComputeActivityErrorResponseDto = IApiErrorResponseDto;

export type IGetComputeActivityEndpointResult =
  | { status: 200; body: IGetComputeActivityOkResponseDto }
  | { status: HttpErrorStatus; body: IGetComputeActivityErrorResponseDto };

export const getComputeActivityOkResponseSchema = apiOkResponseDtoSchema(
  getComputeActivityResponseDataSchema
);
export const getComputeActivityErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapComputeActivitySnapshotToDto = (
  snapshot: TableComputeActivitySnapshot
): Result<IGetComputeActivityResponseDataDto, DomainError> => {
  return ok({
    tableId: snapshot.tableId,
    baseId: snapshot.baseId,
    table: snapshot.table
      ? {
          status: snapshot.table.status,
          calculatingFieldCount: snapshot.table.calculatingFieldCount,
          queuedFieldCount: snapshot.table.queuedFieldCount,
          estimatedComplexity: snapshot.table.estimatedComplexity || undefined,
          recentCompletions: snapshot.table.recentCompletions,
          computeMode: 'server' as const,
          generation: snapshot.table.generation,
          updatedAt: snapshot.table.updatedAt,
        }
      : null,
    fields: snapshot.fields.map((field) => ({
      fieldId: field.fieldId,
      tableId: field.tableId,
      baseId: field.baseId,
      status: field.status,
      estimatedComplexity: field.estimatedComplexity || undefined,
      estimatedDirtyRecords: field.estimatedDirtyRecords || undefined,
      startedAt: field.startedAt ?? undefined,
      lastDurationMs: field.lastDurationMs ?? undefined,
      lastError: field.lastError,
      activeTaskCount: field.activeTaskCount,
      processingTaskCount: field.processingTaskCount,
      generation: field.generation,
      hasAllTargetRecords: field.hasAllTargetRecords,
      queuedAt: field.queuedAt,
      updatedAt: field.updatedAt,
      lastCompletedAt: field.lastCompletedAt,
      batchProgress: getFieldComputeBatchProgress(field),
    })),
    diagnostics: snapshot.diagnostics,
  });
};
