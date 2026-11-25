import { Injectable } from '@nestjs/common';
import {
  err,
  LinkForeignTableReferenceVisitor,
  ok,
  TableOperationCreateManySource,
  TableOperationKind,
  type DomainError,
  type ITableOperationPlugin,
  type Result,
  type Table,
  type TableOperationPluginContext,
} from '@teable/v2-core';
import { CustomHttpException } from '../../custom.exception';
import type { FieldReferenceAdmissionService } from '../field-reference-admission/field-reference-admission.service';
import { toCrossBaseLinkDomainError } from './cross-base-link-access.plugin-support';

export const CROSS_BASE_LINK_ACCESS_TABLE_OPERATION_PLUGIN_NAME =
  'crossBaseLinkAccessTableOperation';

/**
 * Applies the shared host `FieldReferenceAdmissionService` rule to the fields a
 * v2 create-table command carries: every table they reference stays in the
 * base's space, and one in another base must be readable by the caller.
 *
 * Adding a field is covered by `CrossBaseLinkAccessFieldOperationPlugin`, but
 * create-table runs the field-operation plugins for side effects only, so the
 * new table's own link, lookup and rollup fields need this check.
 *
 * Covered: `create`, and `createMany` from the createTables command. A
 * duplicated base and an imported `.tea` copy references that already exist and
 * are left as they were. Tables created in the same operation are not foreign
 * to each other.
 */
@Injectable()
export class CrossBaseLinkAccessTableOperationPlugin implements ITableOperationPlugin<undefined> {
  readonly name = CROSS_BASE_LINK_ACCESS_TABLE_OPERATION_PLUGIN_NAME;
  readonly enforce = 'pre' as const;

  constructor(private readonly fieldReferenceAdmission: FieldReferenceAdmissionService) {}

  supports(operation: TableOperationKind): boolean {
    return operation === TableOperationKind.create || operation === TableOperationKind.createMany;
  }

  async prepare(context: TableOperationPluginContext): Promise<Result<undefined, DomainError>> {
    const created = tablesCreatedFromCallerFields(context);
    if (!created) {
      return ok(undefined);
    }

    const foreignTableIds = collectForeignTableIds(created.tables);
    if (foreignTableIds.isErr()) {
      return err(foreignTableIds.error);
    }
    if (!foreignTableIds.value.size) {
      return ok(undefined);
    }

    try {
      await this.fieldReferenceAdmission.assertNewForeignTablesAllowedInBase(
        created.baseId,
        foreignTableIds.value
      );
    } catch (error) {
      if (!(error instanceof CustomHttpException)) {
        throw error;
      }
      return err(
        toCrossBaseLinkDomainError(error, { operation: context.kind, baseId: created.baseId })
      );
    }

    return ok(undefined);
  }
}

const tablesCreatedFromCallerFields = (
  context: TableOperationPluginContext
): { baseId: string; tables: ReadonlyArray<Table> } | undefined => {
  if (context.kind === TableOperationKind.create) {
    const { table, baseId } = context.payload;
    return table ? { baseId: baseId.toString(), tables: [table] } : undefined;
  }
  if (
    context.kind === TableOperationKind.createMany &&
    context.payload.source === TableOperationCreateManySource.createTables
  ) {
    return {
      baseId: context.payload.baseId.toString(),
      tables: context.payload.tables.flatMap(({ table }) => (table ? [table] : [])),
    };
  }
  return undefined;
};

const collectForeignTableIds = (tables: ReadonlyArray<Table>): Result<Set<string>, DomainError> => {
  const createdIds = new Set(tables.map((table) => table.id().toString()));
  const visitor = new LinkForeignTableReferenceVisitor();
  const foreignTableIds = new Set<string>();
  for (const table of tables) {
    const references = visitor.collect(table.getFields());
    if (references.isErr()) {
      return err(references.error);
    }
    for (const { foreignTableId } of references.value) {
      const id = foreignTableId.toString();
      if (!createdIds.has(id)) {
        foreignTableIds.add(id);
      }
    }
  }
  return ok(foreignTableIds);
};
