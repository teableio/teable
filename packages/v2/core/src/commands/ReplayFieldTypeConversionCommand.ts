import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { TableId } from '../domain/table/TableId';
import {
  applyFieldSnapshotInputSchema,
  fieldSnapshotSchema,
  resolveFieldSnapshotForeignTableReferences,
} from './ApplyFieldSnapshotCommand';
import { TableUpdateCommand } from './TableUpdateCommand';

export const replayFieldTypeConversionInputSchema = applyFieldSnapshotInputSchema;

export type IReplayFieldTypeConversionCommandInput = z.input<
  typeof replayFieldTypeConversionInputSchema
>;

export class ReplayFieldTypeConversionCommand extends TableUpdateCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly tableId: TableId,
    readonly snapshot: z.output<typeof fieldSnapshotSchema>
  ) {
    super(baseId, tableId);
  }

  static create(raw: unknown): Result<ReplayFieldTypeConversionCommand, DomainError> {
    const parsed = replayFieldTypeConversionInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ReplayFieldTypeConversionCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return BaseId.create(parsed.data.baseId).andThen((baseId) =>
      TableId.create(parsed.data.tableId).map(
        (tableId) => new ReplayFieldTypeConversionCommand(baseId, tableId, parsed.data.snapshot)
      )
    );
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return resolveFieldSnapshotForeignTableReferences(this.snapshot.field);
  }
}
