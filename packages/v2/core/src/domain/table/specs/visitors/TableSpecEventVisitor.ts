import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { IDomainEvent } from '../../../shared/DomainEvent';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { FieldCreated } from '../../events/FieldCreated';
import { FieldDeleted } from '../../events/FieldDeleted';
import { FieldUpdated } from '../../events/FieldUpdated';
import { TableRenamed } from '../../events/TableRenamed';
import { ViewColumnMetaUpdated } from '../../events/ViewColumnMetaUpdated';
import type { Table } from '../../Table';
import type {
  RemoveSymmetricLinkFieldSpec,
  UpdateButtonColorSpec,
  UpdateButtonLabelSpec,
  UpdateButtonMaxCountSpec,
  UpdateButtonWorkflowSpec,
  UpdateCheckboxDefaultValueSpec,
  UpdateDateDefaultValueSpec,
  UpdateDateFormattingSpec,
  UpdateFormulaExpressionSpec,
  UpdateFormulaFormattingSpec,
  UpdateFormulaShowAsSpec,
  UpdateFormulaTimeZoneSpec,
  UpdateLinkConfigSpec,
  UpdateLinkRelationshipSpec,
  UpdateLongTextDefaultValueSpec,
  UpdateLookupOptionsSpec,
  UpdateMultipleSelectAutoNewOptionsSpec,
  UpdateMultipleSelectDefaultValueSpec,
  UpdateMultipleSelectOptionsSpec,
  UpdateNumberDefaultValueSpec,
  UpdateNumberFormattingSpec,
  UpdateNumberShowAsSpec,
  UpdateRatingColorSpec,
  UpdateRatingIconSpec,
  UpdateRatingMaxSpec,
  UpdateRollupConfigSpec,
  UpdateRollupExpressionSpec,
  UpdateRollupFormattingSpec,
  UpdateRollupShowAsSpec,
  UpdateRollupTimeZoneSpec,
  UpdateSingleLineTextDefaultValueSpec,
  UpdateSingleLineTextShowAsSpec,
  UpdateSingleSelectAutoNewOptionsSpec,
  UpdateSingleSelectDefaultValueSpec,
  UpdateSingleSelectOptionsSpec,
  UpdateUserDefaultValueSpec,
  UpdateUserMultiplicitySpec,
  UpdateUserNotificationSpec,
} from '../field-updates';
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
import type { TableUpdateFieldConstraintsSpec } from '../TableUpdateFieldConstraintsSpec';
import type { TableUpdateFieldDbFieldNameSpec } from '../TableUpdateFieldDbFieldNameSpec';
import type { TableUpdateFieldAiConfigSpec } from '../TableUpdateFieldAiConfigSpec';
import type { TableUpdateFieldDescriptionSpec } from '../TableUpdateFieldDescriptionSpec';
import type { TableUpdateFieldHasErrorSpec } from '../TableUpdateFieldHasErrorSpec';
import type { TableUpdateFieldNameSpec } from '../TableUpdateFieldNameSpec';
import type { TableUpdateFieldTypeSpec } from '../TableUpdateFieldTypeSpec';
import type { TableUpdateViewColumnMetaSpec } from '../TableUpdateViewColumnMetaSpec';
import type { TableUpdateViewQueryDefaultsSpec } from '../TableUpdateViewQueryDefaultsSpec';

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

  visitTableUpdateViewQueryDefaults(
    _spec: TableUpdateViewQueryDefaultsSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
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

  // Field update specs - generate FieldUpdated events
  visitTableUpdateFieldName(
    spec: TableUpdateFieldNameSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['name'],
      })
    );
    return ok(undefined);
  }

  visitTableUpdateFieldDbFieldName(
    spec: TableUpdateFieldDbFieldNameSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['dbFieldName'],
      })
    );
    return ok(undefined);
  }

  visitTableUpdateFieldType(
    spec: TableUpdateFieldTypeSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.newField().id(),
        updatedProperties: ['type'],
      })
    );
    return ok(undefined);
  }

  visitTableUpdateFieldConstraints(
    spec: TableUpdateFieldConstraintsSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    const updatedProperties: string[] = [];
    if (!spec.previousNotNull().equals(spec.nextNotNull())) {
      updatedProperties.push('notNull');
    }
    if (!spec.previousUnique().equals(spec.nextUnique())) {
      updatedProperties.push('unique');
    }
    if (updatedProperties.length > 0) {
      this.eventsCollected.push(
        FieldUpdated.create({
          tableId: this.table.id(),
          baseId: this.table.baseId(),
          fieldId: spec.fieldId(),
          updatedProperties,
        })
      );
    }
    return ok(undefined);
  }

  visitTableUpdateFieldAiConfig(
    spec: TableUpdateFieldAiConfigSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['aiConfig'],
      })
    );
    return ok(undefined);
  }

  visitTableUpdateFieldDescription(
    spec: TableUpdateFieldDescriptionSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['description'],
      })
    );
    return ok(undefined);
  }

  visitTableUpdateFieldHasError(
    spec: TableUpdateFieldHasErrorSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['hasError'],
      })
    );
    return ok(undefined);
  }

  // ============ Field-type-specific update specs ============

  // SingleLineText
  visitUpdateSingleLineTextShowAs(spec: UpdateSingleLineTextShowAsSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['showAs'],
      })
    );
    return ok(undefined);
  }

  visitUpdateSingleLineTextDefaultValue(
    spec: UpdateSingleLineTextDefaultValueSpec
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['defaultValue'],
      })
    );
    return ok(undefined);
  }

  // LongText
  visitUpdateLongTextDefaultValue(spec: UpdateLongTextDefaultValueSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['defaultValue'],
      })
    );
    return ok(undefined);
  }

  // Number
  visitUpdateNumberFormatting(spec: UpdateNumberFormattingSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['formatting'],
      })
    );
    return ok(undefined);
  }

  visitUpdateNumberShowAs(spec: UpdateNumberShowAsSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['showAs'],
      })
    );
    return ok(undefined);
  }

  visitUpdateNumberDefaultValue(spec: UpdateNumberDefaultValueSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['defaultValue'],
      })
    );
    return ok(undefined);
  }

  // Date
  visitUpdateDateFormatting(spec: UpdateDateFormattingSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['formatting'],
      })
    );
    return ok(undefined);
  }

  visitUpdateDateDefaultValue(spec: UpdateDateDefaultValueSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['defaultValue'],
      })
    );
    return ok(undefined);
  }

  // Checkbox
  visitUpdateCheckboxDefaultValue(spec: UpdateCheckboxDefaultValueSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['defaultValue'],
      })
    );
    return ok(undefined);
  }

  // Rating
  visitUpdateRatingMax(spec: UpdateRatingMaxSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['max'],
      })
    );
    return ok(undefined);
  }

  visitUpdateRatingIcon(spec: UpdateRatingIconSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['icon'],
      })
    );
    return ok(undefined);
  }

  visitUpdateRatingColor(spec: UpdateRatingColorSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['color'],
      })
    );
    return ok(undefined);
  }

  // User
  visitUpdateUserMultiplicity(spec: UpdateUserMultiplicitySpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['isMultiple'],
      })
    );
    return ok(undefined);
  }

  visitUpdateUserNotification(spec: UpdateUserNotificationSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['shouldNotify'],
      })
    );
    return ok(undefined);
  }

  visitUpdateUserDefaultValue(spec: UpdateUserDefaultValueSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['defaultValue'],
      })
    );
    return ok(undefined);
  }

  // Button
  visitUpdateButtonLabel(spec: UpdateButtonLabelSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['label'],
      })
    );
    return ok(undefined);
  }

  visitUpdateButtonColor(spec: UpdateButtonColorSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['color'],
      })
    );
    return ok(undefined);
  }

  visitUpdateButtonMaxCount(spec: UpdateButtonMaxCountSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['maxCount'],
      })
    );
    return ok(undefined);
  }

  visitUpdateButtonWorkflow(spec: UpdateButtonWorkflowSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['workflow'],
      })
    );
    return ok(undefined);
  }

  // SingleSelect
  visitUpdateSingleSelectOptions(spec: UpdateSingleSelectOptionsSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['options'],
      })
    );
    return ok(undefined);
  }

  visitUpdateSingleSelectDefaultValue(
    spec: UpdateSingleSelectDefaultValueSpec
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['defaultValue'],
      })
    );
    return ok(undefined);
  }

  visitUpdateSingleSelectAutoNewOptions(
    spec: UpdateSingleSelectAutoNewOptionsSpec
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['autoNewOptions'],
      })
    );
    return ok(undefined);
  }

  // MultipleSelect
  visitUpdateMultipleSelectOptions(
    spec: UpdateMultipleSelectOptionsSpec
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['options'],
      })
    );
    return ok(undefined);
  }

  visitUpdateMultipleSelectDefaultValue(
    spec: UpdateMultipleSelectDefaultValueSpec
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['defaultValue'],
      })
    );
    return ok(undefined);
  }

  visitUpdateMultipleSelectAutoNewOptions(
    spec: UpdateMultipleSelectAutoNewOptionsSpec
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['autoNewOptions'],
      })
    );
    return ok(undefined);
  }

  // Formula
  visitUpdateFormulaExpression(spec: UpdateFormulaExpressionSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['expression'],
      })
    );
    return ok(undefined);
  }

  visitUpdateFormulaFormatting(spec: UpdateFormulaFormattingSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['formatting'],
      })
    );
    return ok(undefined);
  }

  visitUpdateFormulaShowAs(spec: UpdateFormulaShowAsSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['showAs'],
      })
    );
    return ok(undefined);
  }

  visitUpdateFormulaTimeZone(spec: UpdateFormulaTimeZoneSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['timeZone'],
      })
    );
    return ok(undefined);
  }

  // Link
  visitUpdateLinkConfig(spec: UpdateLinkConfigSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['linkConfig'],
      })
    );
    return ok(undefined);
  }

  visitUpdateLinkRelationship(spec: UpdateLinkRelationshipSpec): Result<void, DomainError> {
    const updatedProperties: string[] = ['linkRelationship'];
    if (spec.isRelationshipTypeChanging()) {
      updatedProperties.push('relationship');
    }
    if (spec.isOneWayChanging()) {
      updatedProperties.push('isOneWay');
    }
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties,
      })
    );
    return ok(undefined);
  }

  // Lookup
  visitUpdateLookupOptions(spec: UpdateLookupOptionsSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['lookupOptions'],
      })
    );
    return ok(undefined);
  }

  // Rollup
  visitUpdateRollupConfig(spec: UpdateRollupConfigSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['rollupConfig'],
      })
    );
    return ok(undefined);
  }

  visitUpdateRollupExpression(spec: UpdateRollupExpressionSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['expression'],
      })
    );
    return ok(undefined);
  }

  visitUpdateRollupFormatting(spec: UpdateRollupFormattingSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['formatting'],
      })
    );
    return ok(undefined);
  }

  visitUpdateRollupShowAs(spec: UpdateRollupShowAsSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['showAs'],
      })
    );
    return ok(undefined);
  }

  visitUpdateRollupTimeZone(spec: UpdateRollupTimeZoneSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
        updatedProperties: ['timeZone'],
      })
    );
    return ok(undefined);
  }

  // RemoveSymmetricLinkField - generates FieldDeleted event
  visitRemoveSymmetricLinkField(spec: RemoveSymmetricLinkFieldSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldDeleted.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
      })
    );
    return ok(undefined);
  }
}
