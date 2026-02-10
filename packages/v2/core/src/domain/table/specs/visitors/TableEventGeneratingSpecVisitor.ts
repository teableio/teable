import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { IDomainEvent } from '../../../shared/DomainEvent';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { FieldCreated } from '../../events/FieldCreated';
import { FieldDeleted } from '../../events/FieldDeleted';
import { FieldDuplicated } from '../../events/FieldDuplicated';
import { FieldOptionsAdded } from '../../events/FieldOptionsAdded';
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
 * A visitor that generates domain events based on the specs it visits.
 * Used by TableMutator to generate events after applying mutations.
 */
export class TableEventGeneratingSpecVisitor implements ITableSpecVisitor<void> {
  private readonly events: IDomainEvent[] = [];

  constructor(private readonly table: Table) {}

  getEvents(): ReadonlyArray<IDomainEvent> {
    return this.events;
  }

  visit(_spec: ISpecification<unknown, ITableSpecVisitor>): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableAddField(spec: TableAddFieldSpec): Result<void, DomainError> {
    this.events.push(
      FieldCreated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.field().id(),
      })
    );
    return ok(undefined);
  }

  visitTableAddSelectOptions(spec: TableAddSelectOptionsSpec): Result<void, DomainError> {
    const options = spec.options();
    if (options.length > 0) {
      this.events.push(
        FieldOptionsAdded.create({
          tableId: this.table.id(),
          baseId: this.table.baseId(),
          fieldId: spec.fieldId(),
          options,
        })
      );
    }
    return ok(undefined);
  }

  visitTableDuplicateField(spec: TableDuplicateFieldSpec): Result<void, DomainError> {
    this.events.push(
      FieldDuplicated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        sourceFieldId: spec.sourceField().id(),
        newFieldId: spec.newField().id(),
        includeRecordValues: spec.includeRecordValues(),
      })
    );
    return ok(undefined);
  }

  visitTableRemoveField(spec: TableRemoveFieldSpec): Result<void, DomainError> {
    this.events.push(
      FieldDeleted.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.field().id(),
      })
    );
    return ok(undefined);
  }

  visitTableUpdateViewColumnMeta(spec: TableUpdateViewColumnMetaSpec): Result<void, DomainError> {
    for (const update of spec.updates()) {
      this.events.push(
        ViewColumnMetaUpdated.create({
          tableId: this.table.id(),
          baseId: this.table.baseId(),
          viewId: update.viewId,
          fieldId: update.fieldId,
        })
      );
    }
    return ok(undefined);
  }

  visitTableRename(spec: TableRenameSpec): Result<void, DomainError> {
    this.events.push(
      TableRenamed.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        previousName: spec.previousName(),
        nextName: spec.nextName(),
      })
    );
    return ok(undefined);
  }

  // Query specs do not generate events
  visitTableByBaseId(_spec: TableByBaseIdSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableById(_spec: TableByIdSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByIds(_spec: TableByIdsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByName(_spec: TableByNameSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByNameLike(_spec: TableByNameLikeSpec): Result<void, DomainError> {
    return ok(undefined);
  }
}
