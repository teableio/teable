import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { PublicCommand } from './PublicCommand';

/** Clipboard header metadata, indexed by destination field id (not source id). */
export type TemporaryPasteSourceField = {
  readonly id?: string;
  readonly name?: string;
  readonly type: string;
  readonly options?: unknown;
  readonly cellValueType?: string;
  readonly isComputed?: boolean;
  readonly isLookup?: boolean;
  readonly isConditionalLookup?: boolean;
  readonly isMultipleCellValue?: boolean;
  readonly lookupOptions?: unknown;
  readonly meta?: unknown;
  readonly config?: unknown;
};

const sourceFieldSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.enum([
    'singleLineText',
    'longText',
    'number',
    'rating',
    'singleSelect',
    'multipleSelect',
    'checkbox',
    'attachment',
    'date',
    'user',
    'link',
    'formula',
    'rollup',
    'createdTime',
    'lastModifiedTime',
    'createdBy',
    'lastModifiedBy',
    'autoNumber',
    'button',
    'conditionalRollup',
    'conditionalLookup',
  ]),
  options: z.unknown().optional(),
  cellValueType: z.string().optional(),
  isComputed: z.boolean().optional(),
  isLookup: z.boolean().optional(),
  isConditionalLookup: z.boolean().optional(),
  isMultipleCellValue: z.boolean().optional(),
  lookupOptions: z.unknown().optional(),
  meta: z.unknown().optional(),
  config: z.unknown().optional(),
});

export const temporaryPasteInputSchema = z.object({
  tableId: z.string(),
  records: z.array(z.object({ fields: z.record(z.string(), z.unknown()) })),
  sourceFields: z.record(z.string(), sourceFieldSchema).optional(),
});

export type ITemporaryPasteCommandInput = z.input<typeof temporaryPasteInputSchema>;

/** Converts requested cells and commits metadata effects, without creating records or ids. */
export class TemporaryPasteCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly recordsFieldValues: ReadonlyArray<ReadonlyMap<string, unknown>>,
    readonly sourceFields: Readonly<Record<string, TemporaryPasteSourceField>> | undefined
  ) {
    super();
  }

  static create(raw: unknown): Result<TemporaryPasteCommand, DomainError> {
    const parsed = temporaryPasteInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid TemporaryPasteCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ok(
        new TemporaryPasteCommand(
          tableId,
          parsed.data.records.map((record) => new Map(Object.entries(record.fields))),
          parsed.data.sourceFields
        )
      )
    );
  }
}
