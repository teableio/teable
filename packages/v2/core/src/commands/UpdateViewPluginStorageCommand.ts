import { err, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import { ViewId } from '../domain/table/views/ViewId';
import { PublicCommand } from './PublicCommand';

export const updateViewPluginStorageInputSchema = z
  .object({
    tableId: z.string(),
    viewId: z.string(),
    pluginInstallId: z.string().min(1),
    storage: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type IUpdateViewPluginStorageCommandInput = z.input<
  typeof updateViewPluginStorageInputSchema
>;

export class UpdateViewPluginStorageCommand extends PublicCommand {
  private constructor(
    readonly tableId: TableId,
    readonly viewId: ViewId,
    readonly pluginInstallId: string,
    readonly storage: Readonly<Record<string, unknown>> | undefined
  ) {
    super();
  }

  static create(raw: unknown): Result<UpdateViewPluginStorageCommand, DomainError> {
    const parsed = updateViewPluginStorageInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateViewPluginStorageCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }
    return TableId.create(parsed.data.tableId).andThen((tableId) =>
      ViewId.create(parsed.data.viewId).map(
        (viewId) =>
          new UpdateViewPluginStorageCommand(
            tableId,
            viewId,
            parsed.data.pluginInstallId,
            parsed.data.storage
          )
      )
    );
  }
}
