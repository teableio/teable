import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { BaseName } from '../domain/base/BaseName';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { DEFAULT_TABLE_DATA_SAFETY_LIMITS } from '../domain/shared/TableDataSafetyLimits';
import { MAX_SELECTION_STREAM_BATCH_SIZE } from './shared/streamBatchSize';

export const duplicateBaseByIdInputSchema = z
  .object({
    sourceBaseId: z.string(),
    targetBaseId: z.string().optional(),
    name: z.string().max(DEFAULT_TABLE_DATA_SAFETY_LIMITS.displayText.maxNameLength).optional(),
    withRecords: z.boolean().default(false),
    batchSize: z.number().int().min(1).max(MAX_SELECTION_STREAM_BATCH_SIZE).optional(),
  })
  .strict();

export type IDuplicateBaseByIdCommandInput = z.input<typeof duplicateBaseByIdInputSchema>;

export class DuplicateBaseByIdCommand {
  readonly __publicCommandBrand = 'public' as const;

  private constructor(
    readonly sourceBaseId: BaseId,
    readonly targetBaseId: BaseId | undefined,
    readonly baseName: BaseName | undefined,
    readonly withRecords: boolean,
    readonly batchSize: number
  ) {}

  static create(raw: unknown): Result<DuplicateBaseByIdCommand, DomainError> {
    const parsed = duplicateBaseByIdInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DuplicateBaseByIdCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    const targetBaseIdResult: Result<BaseId | undefined, DomainError> =
      parsed.data.targetBaseId !== undefined
        ? BaseId.create(parsed.data.targetBaseId)
        : ok(undefined);
    const baseNameResult: Result<BaseName | undefined, DomainError> =
      parsed.data.name !== undefined ? BaseName.create(parsed.data.name) : ok(undefined);

    return BaseId.create(parsed.data.sourceBaseId).andThen((sourceBaseId) =>
      targetBaseIdResult.andThen((targetBaseId) =>
        baseNameResult.map(
          (baseName) =>
            new DuplicateBaseByIdCommand(
              sourceBaseId,
              targetBaseId,
              baseName,
              parsed.data.withRecords,
              parsed.data.batchSize ?? 500
            )
        )
      )
    );
  }
}
