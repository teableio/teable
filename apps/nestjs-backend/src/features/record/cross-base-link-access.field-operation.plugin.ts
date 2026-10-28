import { Injectable } from '@nestjs/common';
import {
  err,
  FieldOperationKind,
  FieldOperationTargetKind,
  LinkForeignTableReferenceVisitor,
  ok,
  type DomainError,
  type FieldOperationPluginContext,
  type IFieldOperationPlugin,
  type Result,
} from '@teable/v2-core';
import { CustomHttpException } from '../../custom.exception';
import type { FieldSupplementService } from '../field/field-calculate/field-supplement.service';
import { toCrossBaseLinkDomainError } from './cross-base-link-access.plugin-support';

export const CROSS_BASE_LINK_ACCESS_FIELD_OPERATION_PLUGIN_NAME =
  'crossBaseLinkAccessFieldOperation';

/**
 * Applies the same rule the v1 field paths enforce through
 * `FieldSupplementService`, for the v2 field create/convert commands:
 * - every referenced foreign table must stay in the host table's space;
 * - a foreign table the field did not reference before must also be readable
 *   by the caller when it is in another base.
 *
 * `foreignTables` on an update is the union of the new references and the ones
 * the field already had; the previous field says which is which. Only newly
 * referenced tables are checked: a reference the field already holds passed
 * this rule when the field was created, and re-checking it would reject a
 * rename or a conversion away from a legacy cross-space reference that v1
 * accepts.
 *
 * Side-effect fields are skipped: the plugin context for those points at the
 * foreign table being touched, and their references come from the direct field
 * checked in this same operation.
 */
@Injectable()
export class CrossBaseLinkAccessFieldOperationPlugin implements IFieldOperationPlugin<undefined> {
  readonly name = CROSS_BASE_LINK_ACCESS_FIELD_OPERATION_PLUGIN_NAME;
  readonly enforce = 'pre' as const;

  constructor(private readonly fieldSupplementService: FieldSupplementService) {}

  supports(operation: FieldOperationKind): boolean {
    return operation === FieldOperationKind.create || operation === FieldOperationKind.update;
  }

  async prepare(context: FieldOperationPluginContext): Promise<Result<undefined, DomainError>> {
    if (context.target.kind !== FieldOperationTargetKind.direct) {
      return ok(undefined);
    }

    const tableId = context.table.id().toString();
    const previousForeignTableIds = await this.collectPreviousForeignTableIds(context);
    if (previousForeignTableIds.isErr()) {
      return err(previousForeignTableIds.error);
    }

    try {
      for (const foreignTable of context.payload.foreignTables) {
        const foreignTableId = foreignTable.id().toString();
        if (previousForeignTableIds.value.has(foreignTableId)) {
          continue;
        }
        await this.fieldSupplementService.assertNewForeignTableAllowed(tableId, foreignTableId);
      }
    } catch (error) {
      if (!(error instanceof CustomHttpException)) {
        throw error;
      }

      return err(toCrossBaseLinkDomainError(error, { operation: context.kind, tableId }));
    }

    return ok(undefined);
  }

  private async collectPreviousForeignTableIds(
    context: FieldOperationPluginContext
  ): Promise<Result<ReadonlySet<string>, DomainError>> {
    if (context.kind !== FieldOperationKind.update) {
      return ok(new Set());
    }

    const references = await new LinkForeignTableReferenceVisitor().collect([
      context.payload.previousField,
    ]);
    if (references.isErr()) {
      return err(references.error);
    }

    return ok(new Set(references.value.map((reference) => reference.foreignTableId.toString())));
  }
}
