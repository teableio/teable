import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';

export const getViewPluginInstallInputSchema = z
  .object({
    tableId: z.string(),
    viewId: z.string(),
  })
  .strict();

export type IGetViewPluginInstallQueryInput = z.input<typeof getViewPluginInstallInputSchema>;

export class GetViewPluginInstallQuery {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId
  ) {}

  static create(raw: unknown): Result<GetViewPluginInstallQuery, DomainError> {
    const parsed = getViewPluginInstallInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid GetViewPluginInstallQuery input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) => new GetViewPluginInstallQuery(tableId, viewId)
      )
    );
  }
}
