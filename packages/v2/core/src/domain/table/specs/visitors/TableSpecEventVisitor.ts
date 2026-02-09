import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { IDomainEvent } from '../../../shared/DomainEvent';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { FieldCreated } from '../../events/FieldCreated';
import { FieldDeleted } from '../../events/FieldDeleted';
import { TableRenamed } from '../../events/TableRenamed';
import { ViewColumnMetaUpdated } from '../../events/ViewColumnMetaUpdated';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';
import type { TableAddFieldSpec } from '../TableAddFieldSpec';
import type { TableAddSelectOptionsSpec } from '../TableAddSelectOptionsSpec';
import type { TableByBaseIdSpec } from '../TableByBaseIdSpec';
import type { TableByIdSpec } from '../TableByIdSpec';
import type { TableByIdsSpec } from '../TableByIdsSpec';
import type { TableByNameLikeSpec } from '../TableByNameLikeSpec';
import type { TableByNameSpec } from '../TableByNameSpec';
import type { TableDuplicateFieldSpec } from '../TableDuplicateFieldSpec';
import type { TableRemoveFieldSpec } from '../TableRemoveFieldSpec';
import type { TableRenameSpec } from '../TableRenameSpec';
import type { TableUpdateViewColumnMetaSpec } from '../TableUpdateViewColumnMetaSpec';

/**
 * Stateful visitor that generates domain events from table specifications.
 *
 * This visitor traverses table specs and collects the appropriate domain events
 * for each mutation spec type. Query-only specs (ById, ByName for query, etc.)
 * do not generate events.
 *
 * Usage:
 * ```typescript
 * const visitor = TableSpecEventVisitor.create(table, previousTable);
 * const acceptResult = spec.accept(visitor);
 * if (acceptResult.isOk()) {
 *   const events = visitor.collectedEvents();
 * }
 * ```
 */
export class TableSpecEventVisitor implements ITableSpecVisitor<void> {
  private readonly eventsCollected: IDomainEvent[] = [];

  private constructor(
    private readonly table: Table,
    private readonly previousTable: Table
  ) {}

  /**
   * Create a new TableSpecEventVisitor.
   *
   * @param table - The table after mutation (current state)
   * @param previousTable - The table before mutation (for rename events)
   */
  static create(table: Table, previousTable: Table): TableSpecEventVisitor {
    return new TableSpecEventVisitor(table, previousTable);
  }

  /**
   * Returns all events collected during spec traversal.
   */
  collectedEvents(): ReadonlyArray<IDomainEvent> {
    return [...this.eventsCollected];
  }

  visit(_spec: ISpecification<Table, ITableSpecVisitor<void>>): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableAddField(spec: TableAddFieldSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    const field = spec.field();
    this.eventsCollected.push(
      FieldCreated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: field.id(),
      })
    );

    return ok(undefined);
  }

  visitTableAddSelectOptions(
    _spec: TableAddSelectOptionsSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableDuplicateField(
    _spec: TableDuplicateFieldSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableRemoveField(
    spec: TableRemoveFieldSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    const field = spec.field();
    this.eventsCollected.push(
      FieldDeleted.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: field.id(),
      })
    );

    return ok(undefined);
  }

  visitTableUpdateViewColumnMeta(
    spec: TableUpdateViewColumnMetaSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    const updates = spec.updates();

    for (const update of updates) {
      // Get column meta entries to find affected field IDs
      const metaDto = update.columnMeta.toDto();
      for (const fieldIdStr of Object.keys(metaDto)) {
        // Find the field in the table to get proper FieldId
        const field = this.table.getFields().find((f) => f.id().toString() === fieldIdStr);
        if (field) {
          this.eventsCollected.push(
            ViewColumnMetaUpdated.create({
              tableId: this.table.id(),
              baseId: this.table.baseId(),
              viewId: update.viewId,
              fieldId: field.id(),
            })
          );
        }
      }
    }

    return ok(undefined);
  }

  visitTableRename(spec: TableRenameSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    const previousName = spec.previousName();
    const nextName = spec.nextName();

    if (!previousName.equals(nextName)) {
      this.eventsCollected.push(
        TableRenamed.create({
          tableId: this.table.id(),
          baseId: this.table.baseId(),
          previousName,
          nextName,
        })
      );
    }

    return ok(undefined);
  }

  visitTableByBaseId(_spec: TableByBaseIdSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    // Query-only spec, no events generated
    return ok(undefined);
  }

  visitTableById(_spec: TableByIdSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    // Query-only spec, no events generated
    return ok(undefined);
  }

  visitTableByIds(_spec: TableByIdsSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    // Query-only spec, no events generated
    return ok(undefined);
  }

  visitTableByName(spec: TableByNameSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    // Query-only spec, no events generated
    void spec;
    return ok(undefined);
  }

  visitTableByNameLike(
    _spec: TableByNameLikeSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    // Query-only spec, no events generated
    return ok(undefined);
  }
}
