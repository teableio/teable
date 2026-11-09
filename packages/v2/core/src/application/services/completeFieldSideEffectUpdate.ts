import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import {
  composeAndSpecs,
  flattenAndSpecs,
} from '../../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { FieldId } from '../../domain/table/fields/FieldId';
import { RemoveSymmetricLinkFieldSpec } from '../../domain/table/specs/field-updates/RemoveSymmetricLinkFieldSpec';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { TableAddFieldSpec } from '../../domain/table/specs/TableAddFieldSpec';
import { TableRemoveFieldSpec } from '../../domain/table/specs/TableRemoveFieldSpec';
import { TableUpdateViewColumnMetaSpec } from '../../domain/table/specs/TableUpdateViewColumnMetaSpec';
import { TableEventGeneratingSpecVisitor } from '../../domain/table/specs/visitors/TableEventGeneratingSpecVisitor';
import type { Table } from '../../domain/table/Table';
import { TableUpdateResult } from '../../domain/table/TableMutator';

/** Complete an already-mutated reciprocal field update without replaying its lifecycle mutation. */
export const completeFieldSideEffectUpdate = (
  table: Table,
  mutateSpec: ISpecification<Table, ITableSpecVisitor>
): Result<TableUpdateResult, DomainError> => {
  const fieldIds: FieldId[] = [];
  for (const spec of flattenAndSpecs(mutateSpec)) {
    if (
      spec instanceof TableAddFieldSpec ||
      spec instanceof TableRemoveFieldSpec ||
      spec instanceof RemoveSymmetricLinkFieldSpec
    ) {
      fieldIds.push(spec.field().id());
    }
  }

  // Build whole-view payloads from the execution candidate, never a preparation snapshot:
  // later effects on the same table must retain earlier fields and column configuration.
  return (
    fieldIds.length > 0
      ? TableUpdateViewColumnMetaSpec.fromTableWithFieldIds(table, fieldIds).andThen((viewSpec) =>
          viewSpec
            .mutate(table)
            .andThen((updated) =>
              composeAndSpecs([mutateSpec, viewSpec]).map((spec) => ({ table: updated, spec }))
            )
        )
      : ok({ table, spec: mutateSpec })
  ).andThen((updated) => {
    const eventVisitor = new TableEventGeneratingSpecVisitor(updated.table);
    return updated.spec.accept(eventVisitor).map(() => {
      updated.table.recordDomainEvents(eventVisitor.getEvents());
      return TableUpdateResult.create(updated.table, updated.spec);
    });
  });
};
