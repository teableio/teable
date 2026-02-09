import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';

export const undoInputSchema = z.object({
  tableId: z.string(),
  windowId: z.string().optional(),
});

export type IUndoCommandInput = z.input<typeof undoInputSchema>;

export class UndoCommand {
  private constructor(
    readonly tableId: TableId,
    readonly windowId?: string
  ) {}

  static create(raw: unknown): Result<UndoCommand, DomainError> {
    const parsed = undoInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UndoCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).map(
      (tableId) => new UndoCommand(tableId, parsed.data.windowId)
    );
  }
}
