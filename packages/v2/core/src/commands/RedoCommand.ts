import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';

export const redoInputSchema = z.object({
  tableId: z.string(),
  windowId: z.string().optional(),
});

export type IRedoCommandInput = z.input<typeof redoInputSchema>;

export class RedoCommand {
  private constructor(
    readonly tableId: TableId,
    readonly windowId?: string
  ) {}

  static create(raw: unknown): Result<RedoCommand, DomainError> {
    const parsed = redoInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid RedoCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).map(
      (tableId) => new RedoCommand(tableId, parsed.data.windowId)
    );
  }
}
